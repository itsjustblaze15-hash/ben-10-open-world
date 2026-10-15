#!/usr/bin/env python3
"""Omnitrix 2D asset pipeline: remove the WHITE BACKGROUND (only the part connected to the image border), keep every white detail inside the artwork,
clean the anti-aliased edge (no halo), trim, save a transparent PNG next to - never over - the untouched original.

usage: python3 tools/process_omnitrix.py <slot> <source image>      e.g.  python3 tools/process_omnitrix.py icon_fourarms ~/Downloads/fa.png
       python3 tools/process_omnitrix.py --all                       re-process every original in assets/omnitrix/original/
slots: watch_green watch_red icon_<alien id> (diamondhead xlr8 fourarms heatblast upgrade wildmutt ghostfreak ripjaws stinkfly cannonbolt greymatter waybig) frame_<name>
"""
import sys, os, shutil, numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'omnitrix')
ORIG = os.path.join(ROOT, 'original')
MAXDIM = 640

def remove_bg(im, thr=232):
    a = np.array(im.convert('RGBA')).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3]
    near_white = (rgb.min(-1) >= thr) | (alpha < 8)                # candidate background pixels
    lab, n = ndi.label(near_white)                                 # connected components; only those touching the border are background
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) if border else np.zeros_like(near_white)
    # fill-in: a thin white gap enclosed by black outline stays (it is not connected to the border) -> no transparent holes inside the artwork
    # edge refinement: pixels next to the background are a blend  p = a*C + (1-a)*white  with C = the dark outline colour -> recover alpha, set colour to the outline
    band = ndi.binary_dilation(bg, iterations=3) & ~bg
    v = rgb.min(-1)
    out = rgb.copy(); al = np.where(bg, 0.0, 255.0)
    dark = np.minimum(1.0, (255.0 - v) / (255.0 - 40.0))            # 1 where the pixel is as dark as the outline (<=40), 0 at white
    edge = band & (v > 40)
    al[edge] = 255.0 * dark[edge]
    # un-premultiply against white so no light fringe remains: C = (p - 255*(1-a)) / a  (outline colour is ~black, clamp)
    a01 = np.clip(al / 255.0, 1e-3, 1)[..., None]
    un = np.clip((rgb - 255.0 * (1 - a01)) / a01, 0, 255)
    out[edge] = un[edge]
    res = np.dstack([out, al]).astype(np.uint8)
    return Image.fromarray(res, 'RGBA'), bg

def process(slot, src):
    os.makedirs(ORIG, exist_ok=True)
    ext = os.path.splitext(src)[1].lower() or '.png'
    dst_o = os.path.join(ORIG, slot + ext)
    if os.path.abspath(src) != os.path.abspath(dst_o):
        if os.path.exists(dst_o) and not os.path.samefile(src, dst_o): print('original already stored, keeping', dst_o)
        else: shutil.copyfile(src, dst_o)
    im = Image.open(dst_o); res, bg = remove_bg(im)
    bb = res.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
    if bb: res = res.crop((max(0, bb[0] - 2), max(0, bb[1] - 2), min(res.width, bb[2] + 2), min(res.height, bb[3] + 2)))
    s = MAXDIM / max(res.size)
    if s < 1: res = res.resize((round(res.width * s), round(res.height * s)), Image.LANCZOS)
    out = os.path.join(ROOT, slot + '.png'); res.save(out, optimize=True)
    print(slot, im.size, '->', res.size, 'bg removed %.1f%%' % (100 * bg.mean()), out)

if __name__ == '__main__':
    if sys.argv[1] == '--all':
        for f in sorted(os.listdir(ORIG)): process(os.path.splitext(f)[0], os.path.join(ORIG, f))
    else: process(sys.argv[1], sys.argv[2])
