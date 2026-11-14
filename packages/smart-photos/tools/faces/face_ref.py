"""Reference (desktop) implementation of the slice's face pipeline: YuNet detect -> 5-point align -> SFace embed.

The Kotlin slice must reproduce these numbers. Follows OpenCV's FaceDetectorYN / FaceRecognizerSF:
  * YuNet input 1x3x640x640, BGR, raw 0..255 floats (no mean/scale); the image is letterboxed (top-left, no stretch).
  * outputs per stride s in (8,16,32): cls, obj [1,N,1], bbox [1,N,4], kps [1,N,10]; score = sqrt(clamp(cls)*clamp(obj));
    cx=(col+bbox0)*s, cy=(row+bbox1)*s, w=exp(bbox2)*s, h=exp(bbox3)*s; landmark i = ((kps[2i]+col)*s, (kps[2i+1]+row)*s).
  * landmarks order (image-left first): right eye, left eye, nose, right mouth, left mouth.
  * SFace input 1x3x112x112, RGB, raw 0..255, aligned with a similarity transform to the ArcFace 112 template; output 128-d, L2-normalised.
  * cosine match threshold from OpenCV docs: 0.363.
Usage as a module: from face_ref import FaceStack
"""
import numpy as np
import onnxruntime as ort
from PIL import Image

TEMPLATE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)


def _session(path):
    so = ort.SessionOptions(); so.log_severity_level = 4
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def similarity_transform(src, dst):
    """Least-squares similarity (scale, rotation, translation) mapping src->dst; returns 2x3."""
    n = len(src)
    A = np.zeros((2 * n, 4), np.float64); b = np.zeros(2 * n, np.float64)
    for i, ((x, y), (u, v)) in enumerate(zip(src, dst)):
        A[2 * i] = [x, -y, 1, 0]; b[2 * i] = u
        A[2 * i + 1] = [y, x, 0, 1]; b[2 * i + 1] = v
    a, bb, tx, ty = np.linalg.lstsq(A, b, rcond=None)[0]
    return np.array([[a, -bb, tx], [bb, a, ty]], np.float32)


def warp(img_rgb, M, size=112):
    """Inverse-map bilinear warp (no OpenCV dependency)."""
    inv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    sx = inv[0, 0] * xs + inv[0, 1] * ys + inv[0, 2]
    sy = inv[1, 0] * xs + inv[1, 1] * ys + inv[1, 2]
    h, w = img_rgb.shape[:2]
    x0 = np.floor(sx).astype(int); y0 = np.floor(sy).astype(int)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]

    def px(y, x):
        inside = ((x >= 0) & (x < w) & (y >= 0) & (y < h))[..., None]
        return np.where(inside, img_rgb[np.clip(y, 0, h - 1), np.clip(x, 0, w - 1)], 0).astype(np.float32)
    return (px(y0, x0) * (1 - fx) * (1 - fy) + px(y0, x0 + 1) * fx * (1 - fy) + px(y0 + 1, x0) * (1 - fx) * fy + px(y0 + 1, x0 + 1) * fx * fy)


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1]); x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


class FaceStack:
    def __init__(self, yunet, sface, score_thr=0.6, nms_thr=0.3):
        self.det, self.rec = _session(yunet), _session(sface)
        self.score_thr, self.nms_thr = score_thr, nms_thr

    def detect(self, img_rgb):
        h, w = img_rgb.shape[:2]
        s = min(640 / w, 640 / h)
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
        small = np.asarray(Image.fromarray(img_rgb).resize((nw, nh), Image.BILINEAR), np.float32)
        canvas = np.zeros((640, 640, 3), np.float32); canvas[:nh, :nw] = small
        x = canvas[..., ::-1].transpose(2, 0, 1)[None].copy()  # BGR, CHW
        out = dict(zip([o.name for o in self.det.get_outputs()], self.det.run(None, {"input": x})))
        faces = []
        for stride in (8, 16, 32):
            cols = 640 // stride
            cls, obj, bb, kp = (out[f"{n}_{stride}"][0] for n in ("cls", "obj", "bbox", "kps"))
            score = np.sqrt(np.clip(cls[:, 0], 0, 1) * np.clip(obj[:, 0], 0, 1))
            for i in np.where(score >= self.score_thr)[0]:
                r, c = divmod(int(i), cols)
                cx, cy = (c + bb[i, 0]) * stride, (r + bb[i, 1]) * stride
                bw, bh = np.exp(bb[i, 2]) * stride, np.exp(bb[i, 3]) * stride
                lm = np.array([[(kp[i, 2 * k] + c) * stride, (kp[i, 2 * k + 1] + r) * stride] for k in range(5)], np.float32)
                faces.append(([cx - bw / 2, cy - bh / 2, bw, bh], float(score[i]), lm))
        faces.sort(key=lambda f: -f[1]); keep = []
        for f in faces:
            if all(iou(f[0], k[0]) < self.nms_thr for k in keep): keep.append(f)
        return [([v / s for v in b], sc, lm / s) for b, sc, lm in keep]  # back to source pixels

    def embed(self, img_rgb, lm):
        M = similarity_transform(lm, TEMPLATE)
        aligned = warp(img_rgb, M)
        v = self.rec.run(None, {"data": aligned.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        return v / np.linalg.norm(v), aligned
