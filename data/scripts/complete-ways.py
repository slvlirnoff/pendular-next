#!/usr/bin/env python3
"""Trim ways that reference nodes missing from an OSM extract.

Clipped extracts can contain ways that reference nodes outside the clip. MOTIS's street
import stops on those ("invalid location"). Given the list of missing references (the output
of `osmium check-refs --show-ids`, lines "n<node> in w<way>") and a file holding just the
affected ways, this drops the missing node references and the ways left with fewer than two
nodes. complete-ways.sh does the rest with the osmium command-line tool, which is what makes
it fast: only the few thousand affected ways pass through Python.

usage: complete-ways.py MISSING.txt AFFECTED-WAYS.osm.pbf FIXED.osm.pbf
"""
import sys
import osmium


def main(missing_path: str, src: str, dst: str) -> None:
    missing: dict[int, set[int]] = {}
    with open(missing_path) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 3 and parts[0].startswith("n") and parts[2].startswith("w"):
                missing.setdefault(int(parts[2][1:]), set()).add(int(parts[0][1:]))

    trimmed = dropped = 0
    with osmium.SimpleWriter(dst, overwrite=True) as out:
        for o in osmium.FileProcessor(src, osmium.osm.WAY):
            gone = missing.get(o.id, set())
            ok = [r.ref for r in o.nodes if r.ref not in gone]
            if len(ok) >= 2:
                out.add_way(o.replace(nodes=ok))
                trimmed += 1
            else:
                dropped += 1
    print(f"ways trimmed: {trimmed}, dropped: {dropped}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
