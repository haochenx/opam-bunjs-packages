.DEFAULT_GOAL := help
SHELL=/bin/bash

.PHONY: check-setup help 
.PHONY: regen-known query-new-releases check-new-releases

check-setup:
	@which bun > /dev/null || (echo "Bun is not install. Hint: https://bun.sh/docs/installation" && exit 127)

regen-known: check-setup query-new-releases ## generate opam package definitions to packages/ according to data/known-interesting-versions.txt
	cat data/known-interesting-versions.txt | xargs -n $(shell wc -l <data/known-interesting-versions.txt) scripts/generate-packages.ts -s data/known-checksums -vj data/jar.tmp.json -d packages/bunjs

query-new-releases: ## update data/known-versions.txt
	scripts/list-recent-released-versions.sh -j data/jar.tmp.json >> data/known-versions.txt
	sort -uo data/known-versions.txt{,}

check-new-releases: query-new-releases ## run query-new-releases and check whether data/known-versions.txt was up-to-date
	git diff --exit-code data/known-versions.txt

help: ## Print this help message
	@echo "List of available make commands";
	@echo "";
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}';
	@echo "";
