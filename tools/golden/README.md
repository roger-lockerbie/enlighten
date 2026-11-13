# Golden fixtures

This folder will hold the generators that produce Enlighten's golden fixtures: DALI frames and hasseb reports, written by python-dali. The fixtures are the oracle that the TypeScript DALI core must match byte for byte. There is no generator yet (Stage 3 adds them).

python-dali is LGPL-3.0. It is used here as a reference and a dev-time oracle only. Its code is not copied into the repo and is not part of the running app.

## Set up

You need Python 3.10 or later. The virtual environment is git-ignored.

```bash
python3 -m venv tools/golden/.venv
tools/golden/.venv/bin/python -m pip install --require-hashes -r tools/golden/requirements.txt
```

`requirements.txt` pins python-dali 0.16 and hidapi 0.15.0 by hash. python-dali's hasseb driver imports hidapi, so the hasseb report generator needs both. To change a version, edit `requirements.in` and recompile with `pip-compile --generate-hashes --allow-unsafe --no-annotate`.

## Run Python from here

Run scripts with `python -I`, so a stray file next to a script can't shadow a module.
