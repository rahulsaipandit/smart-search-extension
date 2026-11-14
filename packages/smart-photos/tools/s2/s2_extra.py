"""S2 extra: text-tower drift, mixed configs, and a better int8 quantisation of the vision tower.
Usage: python s2_extra.py <photos_dir> <models_dir> <out_dir>
"""
import sys, os, json
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
from tokenizers import Tokenizer
sys.path.insert(0, os.path.dirname(__file__))

photos, models, out = sys.argv[1:4]
E = np.load(os.path.join(out, "embeds.npz"), allow_pickle=True)
paths, f32, i8 = E["paths"], E["img_fp32"], E["img_int8"]
Q = ["seaside", "ocean", "beach", "sunset", "birthday cake", "snow", "mountains", "forest", "flowers", "dog", "cat", "food",
     "restaurant", "temple", "fireworks", "kids playing", "wedding", "city at night", "car", "airport", "group photo", "selfie",
     "street", "boat", "lake", "garden", "festival", "baby", "bicycle", "river", "waterfall", "park", "airplane window",
     "christmas tree", "swimming pool", "hotel room", "road trip", "a person smiling", "building", "sky"]
tok = Tokenizer.from_file(os.path.join(models, "clip_tokenizer.json")); tok.no_padding(); tok.no_truncation()
S = {k: ort.InferenceSession(os.path.join(models, f), providers=["CPUExecutionProvider"])
     for k, f in [("fp32", "clip_b32_text_fp32.onnx"), ("int8", "clip_b32_text_int8.onnx")]}


def et(kind, q):
    v = S[kind].run(None, {"input_ids": np.array([tok.encode("a photo of " + q).ids[:77]], np.int64)})[0][0]
    return v / np.linalg.norm(v)


T = {k: np.stack([et(k, q) for q in Q]) for k in S}
tcos = (T["fp32"] * T["int8"]).sum(1)
print("text cos int8 vs fp32: mean %.4f min %.4f" % (tcos.mean(), tcos.min()))


def overlap(ref_img, cand_img, cand_txt, k=10):
    o = []
    for qi in range(len(Q)):
        a = np.argsort(-(ref_img @ T["fp32"][qi]))[:k]
        b = np.argsort(-(cand_img @ cand_txt[qi]))[:k]
        o.append(len(set(a) & set(b)) / k)
    return float(np.mean(o))


res = {"text_cos_mean": float(tcos.mean()), "text_cos_min": float(tcos.min()),
       "overlap@10 int8 text x fp32 img (desktop-built index, tablet text)": overlap(f32, f32, T["int8"]),
       "overlap@10 fp32 text x int8 img": overlap(f32, i8, T["fp32"]),
       "overlap@10 int8 x int8 (all-on-tablet as shipped)": overlap(f32, i8, T["int8"])}

# --- better int8 vision: requantise from fp32 on a subset and compare image vectors
import numpy as np
from PIL import Image, ImageOps
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32); STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)


def prep(p):
    im = ImageOps.exif_transpose(Image.open(os.path.join(photos, p))).convert("RGB")
    s = 224 / min(im.size); im = im.resize((max(224, round(im.width * s)), max(224, round(im.height * s))), Image.BICUBIC)
    l, t = (im.width - 224) // 2, (im.height - 224) // 2
    return ((np.asarray(im.crop((l, t, l + 224, t + 224)), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)


idx = np.random.default_rng(1).choice(len(paths), 120, replace=False)
X = np.stack([prep(paths[i]) for i in idx])
src = os.path.join(models, "clip_b32_vision_fp32.onnx")
variants = {
    "dyn int8 per-tensor, MatMul only": dict(op_types_to_quantize=["MatMul"], per_channel=False),
    "dyn int8 per-channel, MatMul only": dict(op_types_to_quantize=["MatMul"], per_channel=True),
    "dyn int8 per-channel, MatMul+Gemm": dict(op_types_to_quantize=["MatMul", "Gemm"], per_channel=True),
}
vres = {}
for name, kw in variants.items():
    dst = os.path.join(out, "v_" + str(abs(hash(name)) % 10**6) + ".onnx")
    try:
        quantize_dynamic(src, dst, weight_type=QuantType.QInt8, **kw)
        s = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
        v = np.concatenate([s.run(None, {"pixel_values": X[j:j + 16]})[0] for j in range(0, len(X), 16)])
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        c = (v * f32[idx]).sum(1)
        vres[name] = {"cos_mean": float(c.mean()), "cos_min": float(c.min()), "size_MB": round(os.path.getsize(dst) / 1e6, 1)}
        print(name, vres[name], flush=True)
    except Exception as e:
        vres[name] = {"error": str(e)[:200]}; print(name, "ERR", e, flush=True)
# baseline on same subset for comparison
c0 = (i8[idx] * f32[idx]).sum(1)
vres["Xenova int8 (as tested)"] = {"cos_mean": float(c0.mean()), "cos_min": float(c0.min()), "size_MB": 89.1}
res["requantised"] = vres
json.dump(res, open(os.path.join(out, "extra.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
