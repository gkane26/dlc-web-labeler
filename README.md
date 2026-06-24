# DLC web labeler

## Getting Started

### Prereqs

- node: `brew install node`
- [uv](https://docs.astral.sh/uv/getting-started/installation/)

### Setup

```
# install frontend
cd frontend
npm install  # install node dependencies
npm run build  # build frontend app

# install backend
uv sync
```

### Run app

With required options:
```
uv run dlc-web-labeler --config <path to dlc config yaml> --token <your password>
```

For all options: `uv run dlc-web-labeler --help`.
