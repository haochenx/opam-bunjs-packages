.DEFAULT_GOAL := help
.PHONY: check-setup help

SHELL=/bin/bash

check-setup:
	@which bun > /dev/null || (echo "Bun is not install. Hint: https://bun.sh/docs/installation" && exit 127)

regen-known: check-setup ## generate opam package definitions to packages/ according to data/known-interesting-versions.txt
	scripts/list-recent-released-versions.sh -j data/jar.tmp.json >> data/known-versions.txt
	cat data/known-versions.txt | sort | uniq > data/known-versions.txt
	cat data/known-interesting-versions.txt | xargs -n $(shell wc -l <data/known-interesting-versions.txt) scripts/generate-packages.ts -s data/known-checksums -vj data/jar.tmp.json -d packages/bunjs

help: ## Print this help message
	@echo "List of available make commands";
	@echo "";
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}';
	@echo "";
