# BaseCode IsoViewer

Builds an interactive HTML report from the IsoQuant output of a BaseCode run.
The report is a single self-contained file: it opens in any browser, works
offline and needs no server.

Version: see [`VERSION`](VERSION).

## Requirements

- Python 3.10 or newer, with numpy and pandas
- Node.js 18 or newer, only for running the tests

## Usage

Go to the folder of a BaseCode run and point the builder at it. It finds the
IsoQuant results inside (`results/isoquant`) by itself:

```bash
cd /path/to/run/BaseCode
PYTHONPATH=/path/to/BaseCodeIsoViewer python3 -m isoviewer build .
```

This writes `<run>_isoviewer_v<version>.html` into the current folder; add
`-o report.html` to choose the file name. Instead of `.` you can give any path
to the run: the run folder, its `BaseCode` or `results` folder, or
`results/isoquant` itself.

To list the input files that would be read, without building:

```bash
PYTHONPATH=/path/to/BaseCodeIsoViewer python3 -m isoviewer inspect .
```

Add `--help` after `build` to see all options.

The first build parses the gene annotation database and caches the result under
`~/.cache/isoviewer` (or `$XDG_CACHE_HOME/isoviewer`), so later builds of runs
that use the same annotation are faster.

## Tests

```bash
tests/run.sh /path/to/run/BaseCode
```

Builds a report from the given run into a temporary folder and checks that it
works: every page of the report is rendered in a simulated browser, and a set
of checks confirms that the numbers and charts are consistent. It ends with
PASS or FAIL and does not change anything in the run folder.

## License

Proprietary. Copyright Basic Genomics AB, all rights reserved. See [`LICENSE`](LICENSE).
