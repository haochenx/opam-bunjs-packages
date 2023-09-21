#!/usr/bin/env bun

import parseArgs from "minimist";
import _ from "lodash";
import { exit } from "process";
import { mkdir } from 'node:fs/promises';

/* PROGRAM ARGUMENTS
 * -j <jar.json> : specify jar file path
 * -d <dest> : specify output directory
 * -s <checksum saving directory> : if specified, save checksum files to that directory
 * -D : debug
 * -v : verbose
 * -h : help
 */
const cliArgs = parseArgs(process.argv);
const verbose = cliArgs["v"] === true;
const debug = cliArgs["D"] === true;

if (cliArgs["h"] === true || typeof cliArgs["j"] !== "string" || typeof cliArgs["d"] !== "string") {
  console.error(`usage: ${import.meta.file} [-h][-j jar_json][-d output_dir] tag_name...`);
  exit(2);
}

type JarJsonShape = {
  [tag: string]: {
    name: string;
    url: string;
    tag: string;
    version: string;
    versionParsed: null | number[];
    assets: {
      [zipFileName: string]: {
        size: number;
        state: "uploaded" | string;
        content_type: string;
        browser_download_url: string;
      }
    }
  }
};
type ChecksumsEntryShape = {
  sha256: string;
};
type ChecksumBagShape = {
  [tag: string]: ChecksumsEntryShape
};

const variants: {
  [suffix: string]: {
    opam_filters: {
      arch_filter: string;
      os_filter: string;
      additional_filter_clause?: string;
    };
  }
} = {
  "darwin-aarch64": {
    opam_filters: {
      os_filter: `os = "macos"`,
      arch_filter: `arch = "arm64"`,
    }
  },
  "darwin-x64": {
    opam_filters: {
      os_filter: `os = "macos"`,
      arch_filter: `arch = "x86_64"`,
    }
  },
  "linux-aarch64": {
    opam_filters: {
      os_filter: `os = "linux"`,
      arch_filter: `arch = "arm64"`,
      additional_filter_clause: `os-distribution != "alpine"`,
    }
  },
  "linux-x64": {
    opam_filters: {
      os_filter: `os = "linux"`,
      arch_filter: `arch = "x86_64"`,
      additional_filter_clause: `os-distribution != "alpine"`,
    }
  },
};


const scriptDir = import.meta.dir;
const jarSource = cliArgs["j"]
const destDir = cliArgs["d"]
const checksumSavingDir = cliArgs["s"]

const jar: JarJsonShape = await (Bun.file(jarSource).json()
  .then(jar => {
    if (typeof jar !== "object" || jar == null) {
      throw new Error(`Bad jar file content`);
    } else {
      return jar;
    }
  })
  ).catch(e => {
    console.error(`failed to load jar file: ${jarSource}`);
    exit(1);
  });

const tagNames = cliArgs._.slice(2);
if (verbose) {
  console.log("tagNames:", tagNames);
  console.log("variants:", Object.keys(variants));
}
if (debug) console.log("variants definitions:", variants);

if (verbose) console.log("retrieving checksums...");
const checksumBag: ChecksumBagShape = await new Response(Bun.spawn([
  "/usr/bin/env", `${scriptDir}/retrieve-shasum256.sh`,
   "-j", jarSource,
   ...(checksumSavingDir && typeof checksumSavingDir === "string"
    ? ["-s", checksumSavingDir]
    : []),
   ...tagNames], {
  stderr: "inherit"
}).stdout).json().catch(e => {
  console.error(`failed to run retrieve-shasum256.sh script`);
  exit(1);
});

if (debug) console.log("checksums:", checksumBag);

type RelevantInfoShape = JarJsonShape & {
  [tag: string]: {
    assets: {
      [zipFileName: string]: {
        checksums: ChecksumsEntryShape;
      }
    }
  }
};
const relevant: RelevantInfoShape = _.pick(_.cloneDeep(jar), tagNames) as RelevantInfoShape;
for (const tag of Object.keys(relevant)) {
  const checksums = checksumBag[tag];
  const entry = relevant[tag];
  for (const zip of Object.keys(checksums)) {
    if (zip in entry.assets) {
      entry.assets[zip].checksums = checksums[zip];
    }
  }
  for (const assetName of Object.keys(entry.assets)) {
    if (assetName.endsWith(".txt") || assetName.endsWith(".asc")) {
      delete entry.assets[assetName];
    }
  }
}

if (debug) console.log("relevant:", relevant);

function opamFileTemplate({suffix, version, releaseNotesUrl, zipUrl, sha256Checksum, availabilityFilter}) {
  return `opam-version: "2.0"
maintainer: "haochenx@acm.org"
authors: ["Jarred Sumner" "Bun Developers and Contributors"]
homepage: "https://github.com/oven-sh/bun"
bug-reports: "https://github.com/oven-sh/bun/issues"
dev-repo: "git+https://github.com/oven-sh/bun.git"
license: "MIT"
build: [
  [ "unzip" "bun-${suffix}.zip" ]
  [ "chmod" "-R" "+x" "bun-${suffix}" ]
  [ "mv" "bun-${suffix}/bun" "." ]
  [ "./bun" "--version" ] {with-test}
  [ "ln" "-s" "./bun" "bunx" ]
  [ "chmod" "+x" "bunx" ]
  [ "./bunx" "bun" "--version" ] {with-test}
  [ "bash" "-c" "echo 'bin: [ \\"bun\\" \\"bunx\\" ]' > %{name}%.install" ]
]
depends: []
synopsis: "Incredibly fast JavaScript runtime, bundler, test runner, and package all in one"
description: """
Bun (https://bun.sh) is an all-in-one toolkit for JavaScript and TypeScript apps.
It ships as a single executable called bun​.

At its core is the Bun runtime, a fast JavaScript runtime designed as a drop-in replacement for Node.js.
It's written in Zig and powered by JavaScriptCore under the hood,
dramatically reducing startup times and memory usage.

Homepage: <https://github.com/oven-sh/bun>
Release Notes: <${releaseNotesUrl}>
"""
post-messages: [ "Command \`bun\` and \`bunx\`  (v${version}) is installed by the bunjs package." ]
extra-source "bun-${suffix}.zip" {
  src: "${zipUrl}"
  checksum: "sha256=${sha256Checksum}"
}
available: ${availabilityFilter}` + "\n";
}

async function go({versionTagName, variantSuffix}) {
  const entry = relevant[versionTagName];
  const variantEntry = variants[variantSuffix];
  const version = entry.version;
  const packageDir = `${destDir}/bunjs.${version}+${variantSuffix}`;

  if (verbose) console.debug(`processing ${packageDir}`);
  await mkdir(packageDir, {recursive: true});

  const zipFileName = `bun-${variantSuffix}.zip`;
  const assetEntry = entry.assets[zipFileName];
  const sha256Checksum = assetEntry.checksums.sha256;
  const releaseNotesUrl = entry.url;
  const zipUrl = assetEntry.browser_download_url;
  const availabilityFilter =
   `${variantEntry.opam_filters.os_filter} & ${variantEntry.opam_filters.arch_filter}`
   + (variantEntry.opam_filters.additional_filter_clause
    ? ` & ${variantEntry.opam_filters.additional_filter_clause}`
    : "");

  await Bun.write(`${packageDir}/opam`, opamFileTemplate({
    suffix: variantSuffix, version, releaseNotesUrl, zipUrl, sha256Checksum, availabilityFilter
  }))
}

await (async () => {
  const variantSuffixes = Object.keys(variants);
  const jobs = tagNames.flatMap(tag => variantSuffixes.map(suffix => [tag, suffix]))
    .map(([versionTagName, variantSuffix]) => 
      go({versionTagName, variantSuffix}).catch(e => {
        console.error(`cannot process for ${{versionTagName, variantSuffix}}: ` + e);
        throw e;
      }));
  await Promise.allSettled(jobs);
  if (verbose) console.log("done.");
})();
