#!/usr/bin/env python3
"""Make an OSM extract referentially complete for ways.

Clipped extracts can contain ways that reference nodes outside the clip. MOTIS's street
import stops on those ("invalid location"). This drops the missing node references and
removes ways left with fewer than two nodes.

usage: complete-ways.py IN.osm.pbf OUT.osm.pbf
"""
import sys
import osmium


def main(src: str, dst: str) -> None:
    nodes = osmium.index.IdSet()
    n = 0
    for o in osmium.FileProcessor(src, osmium.osm.NODE):
        nodes.set(o.id)
        n += 1
    print(f"nodes: {n}", flush=True)

    kept = trimmed = dropped = 0
    with osmium.SimpleWriter(dst, overwrite=True) as out:
        for o in osmium.FileProcessor(src):
            if o.is_way():
                refs = [r.ref for r in o.nodes]
                ok = [r for r in refs if nodes.get(r)]
                if len(ok) == len(refs):
                    out.add_way(o)
                    kept += 1
                elif len(ok) >= 2:
                    out.add_way(o.replace(nodes=ok))
                    trimmed += 1
                else:
                    dropped += 1
            elif o.is_node():
                out.add_node(o)
            elif o.is_relation():
                out.add_relation(o)
    print(f"ways kept: {kept}, trimmed: {trimmed}, dropped: {dropped}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
