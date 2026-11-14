"""Count-only sanity check of face_ref on a random photo sample (no images are displayed or saved).
Usage: python sample_check.py <photos_dir> <paths_npz> <models_dir> <out_json>"""
import os, sys, json, time, numpy as np
from PIL import Image, ImageOps
from face_ref import FaceStack
root, paths_npz, dl, outj = sys.argv[1:5]
paths = list(np.load(paths_npz, allow_pickle=True)["paths"])
pick = np.random.default_rng(7).choice(len(paths), 120, replace=False)
fs = FaceStack(os.path.join(dl, "yunet.onnx"), os.path.join(dl, "sface.onnx"))
counts, sizes, embs, tdet, temb, best = [], [], [], [], [], None
for i in pick:
    im = Image.open(os.path.join(root, paths[i])); im.draft("RGB", (1280, 1280))
    a = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    t = time.time(); faces = fs.detect(a); tdet.append(time.time() - t); counts.append(len(faces))
    for b, sc, lm in faces:
        sizes.append(b[2] / a.shape[1] * 100)
        t = time.time(); v, _ = fs.embed(a, lm); temb.append(time.time() - t); embs.append(v)
        if len(faces) == 1 and sc > 0.9 and (best is None or b[2] > best[0]): best = (b[2], paths[i], sc)
c = np.array(counts)
print("photos", len(c), "with >=1 face", int((c > 0).sum()), "total faces", int(c.sum()), "max per photo", int(c.max()))
print("face width, percent of image width: median %.1f, p10 %.1f" % (np.median(sizes), np.percentile(sizes, 10)))
print("desktop latency ms: detect %.0f, embed %.0f" % (np.mean(tdet) * 1000, np.mean(temb) * 1000))
V = np.stack(embs); S = V @ V.T; iu = np.triu_indices(len(V), 1)
print("pairwise cosine: median %.2f, share >= 0.363: %.1f percent" % (np.median(S[iu]), 100 * (S[iu] >= 0.363).mean()))
json.dump({"best": best[1] if best else None}, open(outj, "w"))
print("test photo chosen (path only):", best[1] if best else None)
