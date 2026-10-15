// Safe clone of a loaded GLB scene (same algorithm as three's SkeletonUtils.clone): new nodes, NEW skeletons bound to the cloned bones, geometry shared (read-only),
// materials CLONED so tinting / flashing one instance never touches the original or another instance.
import * as THREE from 'three';

function parallel(a, b, cb) { cb(a, b); for (let i = 0; i < a.children.length; i++) parallel(a.children[i], b.children[i], cb); }

export function cloneScene(source, cloneMaterials = true) {
  const clone = source.clone(); const sl = new Map(), cl = new Map();
  parallel(source, clone, (s, c) => { sl.set(c, s); cl.set(s, c); });
  clone.traverse(node => {
    if (node.isMesh && cloneMaterials) node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
    if (!node.isSkinnedMesh) return;
    const src = sl.get(node); node.skeleton = src.skeleton.clone(); node.bindMatrix.copy(src.bindMatrix);
    node.skeleton.bones = src.skeleton.bones.map(b => cl.get(b)); node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
}
