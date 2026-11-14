"""S2 stage 2: query the embeddings, compare int8 vs fp32, write a local HTML contact sheet.

Usage: python s2_report.py <models_dir> <out_dir>
Reads out_dir/embeds.npz + thumbs.npz. Writes out_dir/metrics.json and out_dir/contact_sheet.html.
The HTML embeds small thumbnails of YOUR photos: keep it local, never publish it.
"""
import sys, os, json, base64, html
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

models, out = sys.argv[1:3]
E = np.load(os.path.join(out, "embeds.npz"), allow_pickle=True)
T = np.load(os.path.join(out, "thumbs.npz"), allow_pickle=True)["thumbs"]
paths, img = E["paths"], {"fp32": E["img_fp32"], "int8": E["img_int8"]}
N = len(paths)

QUERIES = ["seaside", "ocean", "beach", "sunset", "birthday cake", "snow", "mountains", "forest", "flowers",
           "dog", "cat", "food", "restaurant", "temple", "fireworks", "kids playing", "wedding", "city at night",
           "car", "airport", "group photo", "selfie", "street", "boat", "lake", "garden", "festival", "baby",
           "bicycle", "river", "waterfall", "park", "airplane window", "christmas tree", "swimming pool",
           "hotel room", "road trip", "a person smiling", "building", "sky"]

tok = Tokenizer.from_file(os.path.join(models, "clip_tokenizer.json"))
tok.no_padding(); tok.no_truncation()
txt = {k: ort.InferenceSession(os.path.join(models, f), providers=["CPUExecutionProvider"])
       for k, f in [("fp32", "clip_b32_text_fp32.onnx"), ("int8", "clip_b32_text_int8.onnx")]}


def embed_text(kind, q):
    ids = tok.encode(q).ids[:77]
    v = txt[kind].run(None, {"input_ids": np.array([ids], np.int64)})[0][0]
    return v / np.linalg.norm(v)


def rank(kind_t, kind_i, q, template):
    s = img[kind_i] @ embed_text(kind_t, template.format(q))
    order = np.argsort(-s)
    return order, s


# --- image-embedding agreement
cos = (img["fp32"] * img["int8"]).sum(1)
metrics = {"images": int(N),
           "img_cos_int8_vs_fp32": {"mean": float(cos.mean()), "min": float(cos.min()), "p05": float(np.percentile(cos, 5))}}

TEMPLATE = "a photo of {}"
rows, per_q = [], []
for q in QUERIES:
    ref, ref_s = rank("fp32", "fp32", q, TEMPLATE)       # reference: fp32 text x fp32 image
    dep, dep_s = rank("int8", "int8", q, TEMPLATE)       # deployed: int8 text x int8 image
    raw, _ = rank("fp32", "fp32", q, "{}")               # prompt sensitivity (no template)
    ov = lambda a, b, k: len(set(a[:k]) & set(b[:k])) / k
    per_q.append({"q": q, "overlap@10": ov(ref, dep, 10), "overlap@20": ov(ref, dep, 20), "top1_same": bool(ref[0] == dep[0]),
                  "prompt_overlap@10": ov(ref, raw, 10), "dep_top1": float(dep_s[dep[0]]), "dep_median": float(np.median(dep_s)),
                  "dep_gap_top1_vs_10": float(dep_s[dep[0]] - dep_s[dep[9]])})
    rows.append((q, dep[:8], dep_s[dep[:8]], ref[:8]))
m = lambda key: float(np.mean([p[key] for p in per_q]))
metrics.update({"queries": len(QUERIES), "mean_overlap@10": m("overlap@10"), "mean_overlap@20": m("overlap@20"),
                "top1_same_rate": float(np.mean([p["top1_same"] for p in per_q])), "mean_prompt_overlap@10": m("prompt_overlap@10"),
                "worst_overlap@10": sorted(per_q, key=lambda p: p["overlap@10"])[:5], "per_query": per_q})
json.dump(metrics, open(os.path.join(out, "metrics.json"), "w"), indent=1)


def b64(i):
    return "data:image/jpeg;base64," + base64.b64encode(T[i]).decode()


parts = ["""<!doctype html><meta charset=utf-8><title>S2 contact sheet (local only)</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}h2{margin:18px 0 4px}
.row{display:flex;gap:6px;flex-wrap:wrap}.c{position:relative}.c img{height:110px;display:block;border-radius:4px}
.c label{position:absolute;left:3px;top:3px;background:#000b;padding:1px 4px;border-radius:3px;font-size:12px}
.c span{position:absolute;right:3px;bottom:3px;background:#000b;padding:1px 4px;border-radius:3px;font-size:11px}
.ref img{height:60px;opacity:.85}.ref .both{outline:2px solid #4c8}.ref .only{outline:2px solid #c84}
button{padding:6px 12px;margin:8px 0}#sum{white-space:pre;font-family:monospace}</style>
<h1>S2: CLIP ViT-B/32 int8 retrieval on your folder</h1>
<p>Row 1 per query = <b>deployed config</b> (int8 text + int8 image), top 8, with score. Tick the ones that match the query.
Row 2 (small) = fp32 reference top 8: green outline = also in the deployed top 8, orange = only in fp32.
This page contains your photos' thumbnails. Keep it local.</p>
<button onclick="calc()">Compute precision@8</button><div id=sum></div>"""]
for qi, (q, dep, sc, ref) in enumerate(rows):
    parts.append(f"<h2>{html.escape(q)}</h2><div class=row>")
    for r, i in enumerate(dep):
        parts.append(f"<div class=c><img src='{b64(i)}'><label><input type=checkbox data-q='{qi}'> {r+1}</label><span>{sc[r]:.3f}</span></div>")
    parts.append("</div><div class='row ref'>")
    ds = set(dep.tolist())
    for i in ref:
        parts.append(f"<div class='c {'both' if i in ds else 'only'}'><img src='{b64(i)}'></div>")
    parts.append("</div>")
parts.append("""<script>
const Q=%s;
function calc(){const per=Q.map((q,i)=>{const b=[...document.querySelectorAll('input[data-q="'+i+'"]')];return {q,hits:b.filter(x=>x.checked).length}});
let s='query'.padEnd(22)+'hits/8\\n';per.forEach(p=>s+=p.q.padEnd(22)+p.hits+'\\n');
const tot=per.reduce((a,p)=>a+p.hits,0);s+='\\nprecision@8 (all queries you ticked) = '+(tot/(8*Q.length)).toFixed(3)+'  (tick only if the photo clearly matches; queries with no matching photos in your album will lower this)';
document.getElementById('sum').textContent=s}
</script>""" % json.dumps(QUERIES))
open(os.path.join(out, "contact_sheet.html"), "w", encoding="utf-8").write("".join(parts))
print(json.dumps({k: v for k, v in metrics.items() if k not in ("per_query", "worst_overlap@10")}, indent=1))
print("worst:", [(p["q"], p["overlap@10"]) for p in metrics["worst_overlap@10"]])
