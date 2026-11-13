// live/hero_pack.js — where Copper's backpacks sit on his back, made in the character editor (hero-editor.bat → /live/index.html?hero,
// its backpack section) and written by its server (server/herofile.mjs). hero3d.js carries the one he wears on his chest bone.
// packs: per backpack (1: the simple one, 2: the upgraded one, art/hero3d/backpack.py → assets/c_bp<n>.*) p where the middle of its
//   back panel is (model units, standing at rest: x his left, y up, z the way he faces), r its turn (degrees about those axes, x first:
//   x tips its top toward his head, y turns it to his left, z leans it), s its height (model units: his is 1). As he holds a gun (a run).
// base: the same without a gun (the menus and NEAR Base: the model's own idles, walk and run); one not here sits as with the gun.
(function (root) {
  const P = {
    v: 1,
    packs: {
      1: {"p":[-0.014,0.53,-0.022],"r":[2.5,34,-1.5],"s":0.305},
      2: {"p":[-0.02,0.53,-0.068],"r":[0,27.5,-2.5],"s":0.4},
    },
  };
  root.HERO_PACK = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
