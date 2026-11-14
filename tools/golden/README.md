# Golden fixtures

`generate.py` writes Enlighten's golden fixtures from python-dali: DALI frames, a decoding sweep, multi-frame sequences, hasseb reports and command streams through python-dali's fake gear. The fixtures are the oracle that the TypeScript DALI core and the simulator must match. They live in `tests/golden/`, and the tests read only those files, so CI needs no Python.

python-dali is LGPL-3.0. It is used here as a reference and a dev-time oracle only. Its code is not copied into the repo and is not part of the running app.

| File             | What it holds                                                                                                                            | Read by                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `frames.json`    | Every supported command with sample addresses and values: frame bytes, send-twice, reply kind, device type                               | `tests/golden/frames.test.ts` |
| `decode.json`    | python-dali's decoding of every second byte for a set of first bytes, with device type context 0, 6 and 8                                | `tests/golden/frames.test.ts` |
| `sequences.json` | The DT8 sequences `tools/first_light.py` sends, colour reads, device type and group reads, with ENABLE DEVICE TYPE as the driver adds it | `tests/golden/frames.test.ts` |
| `hasseb.json`    | 10-byte reports from the hasseb driver's `construct`, built with no device, plus firmware, configure and `extract` samples               | Stage 4's report builder      |
| `fakes.json`     | Command streams through `dali/tests/fakes.py` with its replies, and the four known differences from `docs/research/dali.md` section 15   | `tests/golden/fakes.test.ts`  |

## Set up

You need Python 3.10 or later. The virtual environment is git-ignored.

```bash
python3 -m venv tools/golden/.venv
```

```bash
tools/golden/.venv/bin/python -m pip install --require-hashes -r tools/golden/requirements.txt
```

`requirements.txt` pins python-dali 0.16 and hidapi 0.15.0 by hash. python-dali's hasseb driver imports hidapi, so the hasseb report generator needs both. To change a version, edit `requirements.in` and recompile with `pip-compile --generate-hashes --allow-unsafe --no-annotate`.

## Regenerate

```bash
pnpm golden
```

It runs the script with `python -I`, so a stray file next to it can't shadow a module. Running it again on the same python-dali gives the same files, byte for byte.
