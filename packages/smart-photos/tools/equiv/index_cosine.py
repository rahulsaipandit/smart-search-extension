"""Equivalence test (tablet vs desktop), step 2: cosine between every vector in the tablet index and the desktop q8mm vector of the same photo."""
import sys, struct, numpy as np
# usage: python index_cosine.py <index.bin pulled from the tablet> <s2 out dir with embeds.npz + img_q8mm.npy (trailing /)>
idx, OUT = sys.argv[1:3]
E = np.load(OUT + "embeds.npz", allow_pickle=True)
paths = [str(p).replace("\\", "/") for p in E["paths"]]
desk = np.load(OUT + "img_q8mm.npy")
b = open(idx, "rb").read(); o = 0
def u(fmt):
    global o
    v = struct.unpack_from(">" + fmt, b, o); o += struct.calcsize(">" + fmt); return v
magic, = u("i"); ver = 1
if magic == 0x53504959: ver, = u("i")
dim, = u("i"); n, = u("i")
dev = {}
for _ in range(n):
    L, = u("H"); p = b[o:o + L].decode(); o += L
    u("qq")
    cnt = 1
    if ver >= 2: cnt, = u("b")
    else:
        has, = u("?"); cnt = 1 if has else 0
    vs = []
    for _ in range(cnt):
        vs.append(np.frombuffer(b[o:o + 4 * dim], dtype=">f4").astype(np.float32)); o += 4 * dim
    dev[p.split("/photos/2025/")[-1]] = vs
cos = []
for i, p in enumerate(paths):
    v = dev.get(p)
    if v: cos.append(float(v[0] @ desk[i]))
cos = np.array(cos)
print(f"{len(cos)} photos  cosine(device, desktop q8mm): mean={cos.mean():.5f} min={cos.min():.5f} p5={np.percentile(cos,5):.5f} frac>=0.99={np.mean(cos>=0.99):.3f}")
