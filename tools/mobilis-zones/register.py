"""Register PDF -> SVG coordinates using stop marker shapes.
usage: register.py plan-general.pdf svg.json out/pdf.json
Extracts vector markers + words from the PDF, estimates affine PDF->SVG by Hough vote + iterative NN refinement."""
import sys, json
import numpy as np, pdfplumber
from scipy.spatial import cKDTree

def pdf_markers(page):
    rail = {}; bus = {}
    for o in page.curves:
        w = o['x1'] - o['x0']; h = o['bottom'] - o['top']
        col = tuple(round(x, 2) for x in (o.get('non_stroking_color') or ()))
        cx = (o['x0'] + o['x1']) / 2; cy = (o['top'] + o['bottom']) / 2
        if abs(w - 3.8) < 0.15 and abs(h - 3.8) < 0.15 and col == (0.0, 0.0, 0.0, 0.0):
            rail[(round(cx, 1), round(cy, 1))] = (cx, cy)
        elif col == (0.8, 0.0, 0.0, 0.3) and 1.5 < w < 3.2 and 1.5 < h < 3.2 and o['fill']:
            bus[(round(cx, 1), round(cy, 1))] = (cx, cy)
    return np.array(list(rail.values())), np.array(list(bus.values()))

def hough(A, B, scales):
    best = (0, None)
    for s in scales:
        d = (B[None, :, :] - s * A[:, None, :]).reshape(-1, 2)
        H, xe, ye = np.histogram2d(d[:, 0], d[:, 1], bins=[np.arange(d[:,0].min(), d[:,0].max()+2, 2.0), np.arange(d[:,1].min(), d[:,1].max()+2, 2.0)])
        i, j = np.unravel_index(H.argmax(), H.shape)
        if H[i, j] > best[0]: best = (H[i, j], (s, xe[i] + 1, ye[j] + 1))
    return best

def fit_affine(src, dst):
    X = np.c_[src, np.ones(len(src))]
    M, *_ = np.linalg.lstsq(X, dst, rcond=None)
    return M  # 3x2

def apply(M, P): return np.c_[P, np.ones(len(P))] @ M

def main(pdf_path, svg_path, out):
    page = pdfplumber.open(pdf_path).pages[0]
    svg = json.load(open(svg_path))
    prail, pbus = pdf_markers(page)
    srail = np.array([[m['x'], m['y']] for m in svg['markers'] if m['kind'] == 'rail'])
    sbus = np.array([[m['x'], m['y']] for m in svg['markers'] if m['kind'] == 'bus' and m['grp'] != 'text'])
    print('pdf markers rail', len(prail), 'bus', len(pbus), '| svg rail', len(srail), 'bus', len(sbus))
    votes, (s, tx, ty) = hough(srail, prail, np.arange(0.20, 0.25, 0.0005))
    print('hough votes', votes, 's', s, 't', tx, ty)
    # initial: pdf = s*svg + t ; want svg = f(pdf)
    M = fit_affine(prail, (prail - np.array([tx, ty])) / s)
    allp = np.vstack([prail, pbus]); alls = np.vstack([srail, sbus])
    P = np.vstack([prail, pbus]); S = np.vstack([srail, sbus])
    tree = cKDTree(S)
    for thr in [60, 30, 15, 8, 5, 4, 4, 4]:
        pred = apply(M, P); d, idx = tree.query(pred)
        # mutual nearest
        t2 = cKDTree(pred); d2, idx2 = t2.query(S)
        ok = np.array([d[i] < thr and idx2[idx[i]] == i for i in range(len(P))])
        M = fit_affine(P[ok], S[idx[ok]])
        res = np.linalg.norm(apply(M, P[ok]) - S[idx[ok]], axis=1)
        print('thr', thr, 'pairs', ok.sum(), 'rms', np.sqrt((res**2).mean()).round(3), 'max', res.max().round(2))
    # final stats separated by kind
    pred = apply(M, P); d, idx = tree.query(pred)
    ok = np.array([d[i] < 5 and cKDTree(pred).query(S[idx[i]])[1] == i for i in range(len(P))])
    kind_ok = {'rail': int(ok[:len(prail)].sum()), 'bus': int(ok[len(prail):].sum())}
    res = d[ok]
    # characters in content-stream order (pdfplumber word grouping garbles overlapping lines)
    chars = [dict(text=c['text'], x0=c['x0'], x1=c['x1'], top=c['top'], bottom=c['bottom'], size=c['size'], fontname=c['fontname'].split('+')[-1],
                  upright=c['upright'], color=list(c.get('non_stroking_color') or [])) for c in page.chars]
    json.dump(dict(M=M.tolist(), prail=prail.tolist(), pbus=pbus.tolist(), chars=chars,
                   stats=dict(matched=kind_ok, n_pdf=dict(rail=len(prail), bus=len(pbus)), n_svg=dict(rail=len(srail), bus=len(sbus)), rms=float(np.sqrt((res**2).mean())), p95=float(np.percentile(res, 95)), max=float(res.max()), scale=[float(np.hypot(*M[0])), float(np.hypot(*M[1]))], M=M.tolist())),
              open(out, 'w'))
    print(kind_ok, 'rms', np.sqrt((res**2).mean()), 'M', M.round(4).tolist())

main(*sys.argv[1:4])
