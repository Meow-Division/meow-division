// live/penguin.js — the hero: a penguin in an orange chipped-paint helmet with goggles, a plate carrier and a backpack
// (art/refs/penguin2), and the gun it holds — one 3D model with smooth, soft clay shading.
// The model is a signed-distance field raymarched per pixel in one quad, through the same ortho camera as the iso world (30°
// down), so it can face any aim direction. Rigid parts carry their own transforms: the body (feathers, helmet, goggles, vest,
// backpack, eyes, beak, tail), two flippers of two segments each (a soft bend at the elbow), two feet that waddle, and the gun.
// The guns are meshes made in Blender (gunmesh.js draws them with the penguin; the laser is modelled here); DATA.HOLD says where each is held (the bazooka on the shoulder,
// the minigun by its top handle and rear grip, the rifles close to the chest), and PENGUIN.pose solves the flippers onto the grips
// by IK, steering the elbows clear of the body. Units: 1 = the model's height (feet to helmet top).
(function () {
  const PG = (window.PENGUIN = {});
  PG.FS = `
uniform mat3 u_Rb, u_Rkl, u_Rkr, u_Rul, u_Rll, u_Rur, u_Rlr, u_Rg;   // world -> part: body, feet L/R, flipper upper/lower L/R, gun
uniform vec3 u_tb, u_tkl, u_tkr, u_tul, u_tll, u_tur, u_tlr, u_tg;   // part origins in the world (model units, origin on the ground)
uniform vec4 u_seg;                                                   // flipper segment lengths: upper L, lower L, upper R, lower R
uniform vec2 u_anchor; uniform float u_s, u_px, u_elev, u_blink, u_flash, u_alpha, u_lk, u_lit, u_gun, u_spin, u_pump, u_only;
uniform sampler2D u_light; uniform vec4 u_bg, u_bound, u_bound2, u_gb;   // bounds: sphere centre xyz, radius² (body, gun); gun capsule z0 z1 r y
uniform vec3 u_gk;                                                    // the gun's scale (DATA.HOLD[id].k)
// LAYER (drawn into gunmesh.js's layer with the gun's mesh): the pixel's depth is written, the light map read at the pixel's place
// in the view (u_org: the layer's origin there, u_vres: the view's size)
uniform vec2 u_org, u_vres;
#ifdef LAYER
#define LUV vec2((v_px.x + u_org.x) / u_vres.x, 1.0 - (v_px.y + u_org.y) / u_vres.y)
#else
#define LUV scr(v_px)
#endif
const vec3 DARK = vec3(0.2, 0.18, 0.27), CREAM = vec3(0.97, 0.87, 0.73), ORANGE = vec3(0.93, 0.42, 0.13), NAVY = vec3(0.15, 0.14, 0.22),
  FRAME = vec3(0.17, 0.16, 0.23), LENS = vec3(0.14, 0.17, 0.4), GREY = vec3(0.43, 0.39, 0.43), FEET = vec3(0.98, 0.46, 0.1),
  CHIP = vec3(0.4, 0.37, 0.45), EYE = vec3(0.07, 0.06, 0.1), INK = vec3(0.06, 0.05, 0.09),
  GUNM = vec3(0.21, 0.22, 0.27), STEEL = vec3(0.58, 0.6, 0.66), WOOD = vec3(0.6, 0.34, 0.17), OLIVE = vec3(0.38, 0.44, 0.23), RED = vec3(0.82, 0.2, 0.13),
  GLOW = vec3(0.45, 0.96, 1.0), TAN = vec3(0.76, 0.63, 0.44), RUB = vec3(0.14, 0.14, 0.18), BRASS = vec3(0.92, 0.68, 0.27), YEL = vec3(0.98, 0.77, 0.2),
  WHITE = vec3(0.9, 0.9, 0.93), FIRE = vec3(1.0, 0.62, 0.18), POLY = vec3(0.16, 0.16, 0.21), BLUED = vec3(0.17, 0.18, 0.24), RUBB = vec3(0.1, 0.1, 0.125);
#define ZERO (min(int(u_s), 0))                                     // a loop start the compiler can't see through: no unrolling, no inlining 4×
vec2 U(vec2 a, vec2 b){ return a.x < b.x ? a : b; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdE(vec3 p, vec3 r){ float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float sdRB(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdB2(vec2 p, vec2 b){ vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }   // along z
float sdTor(vec3 p, float R, float r){ return length(vec2(length(p.xy) - R, p.z)) - r; }                                                      // a ring round z
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
// the helmet: a big oval dome over the head, its lower edge lower at the back; the goggles and strap hug it
const vec3 HC = vec3(0.0, 0.73, 0.0), HR = vec3(0.286, 0.275, 0.278);
float domeR(float y){ return HR.x * sqrt(max(0.0, 1.0 - pow((y - HC.y) / HR.y, 2.0))); }   // helmet radius at a height
float gogR(float y){ return mix(domeR(0.78) + 0.024, domeR(clamp(y, 0.7, 0.95)) + 0.03, 0.55); }   // the goggles lean back with the dome
// the feather body: a capsule with an oval (front-back) section, a little wider low down; grown, it is the vest
float shell(vec3 p, float r){ vec3 q = p; q.z /= 0.92; q.y -= clamp(q.y, 0.30, 0.70); return (length(q) - r - 0.014 * (1.0 - clamp((p.y - 0.2) / 0.4, 0.0, 1.0))) * 0.92; }
// materials: 1 feathers (dark / cream by facing), 2 flipper & tail, 3 helmet (orange, cream stripe), 4 goggles, 5 navy gear,
// 6 lower beak, 7 grey webbing, 8 feet, 9 orange gear, 10 eye, 11 upper beak; 25 / 26 flippers L / R; the guns 12–24 and 27–34 (see gPistol)
vec2 body(vec3 p){
  float bd = length(p - vec3(0.0, 0.54, -0.03)) - 0.6; if (bd > 0.05) return vec2(bd, 1.0);   // far away: the bounding sphere will do
  vec2 r = vec2(shell(p, 0.228), 1.0);
  vec3 tq = p - vec3(0.0, 0.14, -0.19); tq.yz = mat2(0.77, 0.64, -0.64, 0.77) * tq.yz;                     // tail: a small point, down and back
  r = U(r, vec2(sdE(tq, vec3(0.04, 0.055, 0.018)), 2.0));
  float a = atan(p.x, p.z), rr = length(p.xz), cutY = 0.7 + 0.03 * clamp(p.z / 0.27, -1.0, 1.0);        // the rim: lower at the back
  float hel = smax(sdE(p - HC, HR), cutY - p.y, 0.012);
  float brim = smax(sdE(p - HC, HR + 0.011), abs(p.y - cutY - 0.026) - 0.024, 0.012);                   // a rolled edge round the bottom
  r = U(r, vec2(smin(hel, brim, 0.008), 3.0));
  r = U(r, vec2(smax(sdE(p - HC - vec3(0.0, -0.01, 0.0), HR - 0.014), cutY - 0.028 - p.y, 0.008), 5.0));     // the dark inner lip
  vec3 eg = vec3(abs(p.x) - 0.25, p.y - 0.665, p.z - 0.035);
  r = U(r, vec2(sdRB(eg, vec3(0.04, 0.062, 0.092), 0.028), 5.0));                                         // ear guards
  r = U(r, vec2(length(eg - vec3(0.04, 0.01, 0.0)) - 0.016, 7.0));                                       // their pivot bolts
  vec3 nv = p - vec3(0.0, 0.925, 0.2); nv.yz = rot(0.8) * nv.yz;                                          // the mount plate on the brow
  r = U(r, vec2(sdRB(nv, vec3(0.034, 0.024, 0.01), 0.006), 7.0));
  // goggles: a deep frame on the brow with the lens set well in; the strap round the back, grey buckles at the sides
  float gr = gogR(p.y), gy = p.y - 0.812;
  float gg = max(sdB2(vec2(rr - gr, gy), vec2(0.012, 0.054)) - 0.018, (abs(a) - 0.98) * 0.27);                     // a padded, rounded rim
  gg = smax(gg, -max(sdB2(vec2(rr - gr - 0.045, gy - 0.006), vec2(0.022, 0.032)) - 0.006, (abs(a) - 0.7) * 0.27), 0.008);   // the lens recess
  r = U(r, vec2(gg, 4.0));
  float st = max(sdB2(vec2(rr - domeR(0.79) - 0.008, p.y - 0.79), vec2(0.01, 0.032)) - 0.004, 0.98 - abs(a));
  r = U(r, vec2(st, 5.0));
  r = U(r, vec2(sdRB(vec3(abs(p.x) - 0.282, p.y - 0.79, p.z - 0.03), vec3(0.022, 0.042, 0.04), 0.012), 7.0));       // buckles
  // face: big glossy eyes (squashed by the blink), a two-part beak
  vec3 e = vec3(abs(p.x) - 0.12, p.y - 0.663, p.z - 0.18);
  r = U(r, vec2(sdE(e, vec3(0.034, 0.037 * u_blink + 0.002, 0.015)), 10.0));
  vec3 bq = p - vec3(0.0, 0.624, 0.2); bq.y += bq.z * 0.14;
  r = U(r, vec2(sdE(bq, vec3(0.062, 0.031, 0.08)), 11.0));
  r = U(r, vec2(sdE(p - vec3(0.0, 0.598, 0.195), vec3(0.046, 0.019, 0.058)), 6.0));
  // plate carrier: the body grown, cut to a band; big shoulder pads; an orange chest plate with the patch; MOLLE rows; side pouches
  float vs = smax(shell(p, 0.25), abs(p.y - 0.35) - 0.134, 0.012);
  vs = min(vs, smax(shell(p, 0.256), sdRB(vec3(abs(p.x) - 0.19, p.y - 0.5, p.z), vec3(0.06, 0.055, 0.4), 0.016), 0.006));
  r = U(r, vec2(vs, 5.0));
  float fr = 0.06 - p.z;
  r = U(r, vec2(max(smax(shell(p, 0.264), max(abs(p.y - 0.425) - 0.051, abs(p.x) - 0.18), 0.008), fr), 9.0));    // chest plate
  r = U(r, vec2(max(smax(shell(p, 0.278), max(abs(p.y - 0.41) - 0.036, abs(p.x) - 0.048), 0.005), fr), 7.0));    // patch
  float mo = min(max(abs(p.y - 0.333) - 0.024, abs(p.x) - 0.177), max(abs(p.y - 0.259) - 0.024, abs(p.x) - 0.177));
  r = U(r, vec2(max(smax(shell(p, 0.266), mo, 0.005), fr), 7.0));
  r = U(r, vec2(sdRB(vec3(abs(p.x) - 0.135, p.y - 0.468, p.z - 0.207), vec3(0.024, 0.014, 0.012), 0.005), 7.0));  // strap buckles
  vec3 pq = vec3(abs(p.x) - 0.238, p.y - 0.305, p.z - 0.02);
  r = U(r, vec2(sdRB(pq, vec3(0.036, 0.058, 0.06), 0.014), 9.0));                                          // side pouches
  r = U(r, vec2(sdRB(pq - vec3(0.004, 0.044, 0.0), vec3(0.04, 0.016, 0.064), 0.01), 9.0));                 // their flaps
  // backpack: orange pack with a flap, grey pocket, orange side pouches, navy straps and handle
  r = U(r, vec2(sdRB(p - vec3(0.0, 0.455, -0.29), vec3(0.138, 0.15, 0.078), 0.024), 9.0));
  r = U(r, vec2(sdRB(p - vec3(0.0, 0.565, -0.3), vec3(0.142, 0.045, 0.084), 0.02), 9.0));
  r = U(r, vec2(sdRB(vec3(abs(p.x) - 0.172, p.y - 0.4, p.z + 0.285), vec3(0.036, 0.082, 0.058), 0.014), 9.0));
  r = U(r, vec2(sdRB(p - vec3(0.0, 0.39, -0.37), vec3(0.096, 0.062, 0.022), 0.012), 7.0));
  r = U(r, vec2(sdRB(vec3(abs(p.x) - 0.1, p.y - 0.46, p.z + 0.36), vec3(0.014, 0.15, 0.012), 0.005), 5.0));
  vec3 hq = p - vec3(0.0, 0.612, -0.29); r = U(r, vec2(max(sdB2(vec2(length(hq.xy) - 0.034, hq.z), vec2(0.008, 0.012)) - 0.003, -hq.y), 5.0));
  return r;
}
// a flipper: two flat, tapering paddles (upper from the shoulder, lower from the elbow, both along their local -y) blended at the elbow
float flipper(vec3 qu, vec3 ql, float L1, float L2){
  qu.y += L1 * 0.5; float ku = clamp(-qu.y / L1 + 0.5, 0.0, 1.0); qu.x /= 1.0 - 0.12 * ku; qu.z /= 1.0 - 0.1 * ku;
  float a = sdE(qu, vec3(0.052, L1 * 0.5 + 0.035, 0.104)) * 0.85;
  ql.y += L2 * 0.5; float kl = clamp(-ql.y / L2 + 0.5, 0.0, 1.0); ql.x /= 1.0 - 0.42 * kl; ql.z /= 1.0 - 0.38 * kl;
  float b = sdE(ql, vec3(0.046, L2 * 0.5 + 0.03, 0.094)) * 0.7;
  return smin(a, b, 0.035);
}
float flipL(vec3 p){ return flipper(u_Rul * (p - u_tul), u_Rll * (p - u_tll), u_seg.x, u_seg.y); }
float flipR(vec3 p){ return flipper(u_Rur * (p - u_tur), u_Rlr * (p - u_tlr), u_seg.z, u_seg.w); }
float foot(vec3 q){
  float f = sdE(q - vec3(0.0, 0.022, 0.035), vec3(0.07, 0.026, 0.09));
  for (int i = -1; i <= 1; i++) f = smin(f, sdE(q - vec3(float(i) * 0.045, 0.021, 0.115 - abs(float(i)) * 0.012), vec3(0.031, 0.022, 0.031)), 0.015);
  vec3 l = q; l.y -= clamp(l.y, 0.02, 0.11); l.z += 0.008; return smin(f, length(l) - 0.032, 0.02);
}
// ---------- the guns, in their own frame: origin at the rear grip, z along the barrel, y up, x the holder's left ----------
// Each gun is its big shapes first; the small parts and the cuts (serrations, ports, slots, rails, pins…) only near them. Further
// away the field returns the big shapes' distance less the most a small part sticks out — a safe bound — so far rays step fast.
// Materials: 12 gunmetal (its paint wears to steel on the edges), 13 steel, 15 olive drab, 16 red paint, 17 glow (cyan), 18 tan
// polymer, 19 black polymer (stippled), 20 brass, 21 yellow, 22 white shell, 24 glass, 27 orange paint, 28 blued steel, 29 rubber,
// 31 red-dot lens, 32 screen, 34 knurled steel. The laser is modelled thin and drawn at DATA.HOLD.laser.k (u_gk); the rest at 1.
float sdBx(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float rep(float x, float s, float n){ return x - s * clamp(floor(x / s + 0.5), -n, n); }                 // 2n+1 copies about 0
float cut(float d, float g, float depth){ return max(d, -max(g, -d - depth)); }                         // carve region g<0, depth deep
vec2 polar(vec2 p, float n){ float s = 6.2831853 / n, a = atan(p.y, p.x); a = mod(a + s * 0.5, s) - s * 0.5; return length(p) * vec2(cos(a), sin(a)); }
float cylX(vec3 p, float r, float h){ return sdCyl(p.zyx, r, h); }                                     // a cylinder along x
float cylY(vec3 p, float r, float h){ return sdCyl(p.xzy, r, h); }                                     // along y
float seg(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
float tblade(vec3 t){ t.z -= 22.0 * t.y * t.y; return sdRB(t, vec3(0.0035, 0.012, 0.0035), 0.0025); }   // a trigger blade, curled forward
vec3 gripF(vec3 g){ vec3 h = g - vec3(0.0, -0.035, -0.012); h.yz = rot(-0.3) * h.yz; return h; }        // the pistol grip's frame (raked back)
float pgrip(vec3 g, float w){ return sdRB(gripF(g), vec3(w, 0.052, 0.027), 0.012); }

// the guns of art/refs/guns2 (chunky machined toys): bevelled gunmetal blocks, orange polymer, steel, hex screws. Modelled at
// their drawn size (DATA.HOLD[id].k is 1 for them); every gun's field first takes its big blocks, then the details near them.
float chb(vec3 p, vec3 b, float c, float r){                             // a box, all twelve edges bevelled by c, rounded by r
  b -= r; vec3 q = abs(p); float d = sdBx(p, b);
  d = max(d, (q.x + q.y - b.x - b.y + c) * 0.7071); d = max(d, (q.y + q.z - b.y - b.z + c) * 0.7071);
  return max(d, (q.x + q.z - b.x - b.z + c) * 0.7071) - r; }
float scrX(vec3 p, float r){ return cylX(p, r, 0.0016) - 0.0006; }        // a screw head on a side face
float tgd(vec3 t, vec2 o, vec2 i){                                       // a squared trigger guard in the y-z plane (top at t.y = o.y)
  return max(max(max(sdB2(t.zy, o) - 0.004, -(sdB2(t.zy - vec2(-0.003, 0.006), i) - 0.004)), abs(t.x) - 0.0075), t.y - o.y); }
float trig(vec3 t){ t.z -= 18.0 * t.y * t.y; return sdRB(t, vec3(0.004, 0.015, 0.0045), 0.003); }
float sdCone(vec3 p, float h, float r1, float r2){                        // a capped cone along z, r1 at z = -h, r2 at z = +h
  vec2 q = vec2(length(p.xy), p.z), k1 = vec2(r2, h), k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h), cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  return (cb.x < 0.0 && ca.y < 0.0 ? -1.0 : 1.0) * sqrt(min(dot(ca, ca), dot(cb, cb))); }
float sdTri(vec2 p, float r){ const float k = 1.7320508; p.x = abs(p.x) - r; p.y += r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0 * r, 0.0); return -length(p) * sign(p.y); }

#if !defined(GUN) || GUN == 1
// the pistol, a compact: a tall bevelled slide (five rear serrations, a steel breech block showing through the port on top and down
// the right side, a seam and a cross pin near the front, a steel muzzle bushing high in the front face, a front post with a brass
// dot, a rear sight with steel dots); the frame under it right to the muzzle (takedown, slide stop and magazine catch blocks); a
// squared guard with a serrated front; a short wide grip with an orange panel each side (a line across it, two hex screws) and a
// flared base plate
vec2 gPistol(vec3 g){
  vec3 s = g - vec3(0.0, 0.064, 0.07 - u_pump * 0.04), f = g - vec3(0.0, 0.009, 0.068), t = g - vec3(0.0, -0.034, 0.064);
  vec3 h = g - vec3(0.0, -0.058, -0.026); h.yz = rot(-0.24) * h.yz;
  float sl = chb(s, vec3(0.026, 0.039, 0.142), 0.01, 0.002), fr = chb(f, vec3(0.023, 0.018, 0.139), 0.006, 0.002);
  float gp = chb(h, vec3(0.021, 0.064, 0.05), 0.008, 0.002), gd = tgd(t, vec2(0.05, 0.027), vec2(0.034, 0.015));
  float d0 = min(min(sl, fr), min(gp, gd)); if (d0 > 0.03) return vec2(d0 - 0.015, 12.0);
  sl = cut(sl, max(abs(rep(s.z + 0.104, 0.0105, 2.0)) - 0.0024, abs(s.y + 0.002) - 0.029), 0.004);               // rear serrations
  sl = cut(sl, max(abs(s.z - 0.106) - 0.0011, abs(s.y + 0.002) - 0.034), 0.0018);                              // the seam near the front
  vec3 pt = s - vec3(-0.011, 0.024, 0.03);                                                                          // the port: top and right side
  sl = smax(sl, -sdBx(pt, vec3(0.018, 0.018, 0.033)), 0.0015);
  sl = max(sl, -sdCyl(s - vec3(0.0, 0.006, 0.15), 0.009, 0.03));
  vec2 r = vec2(sl, 12.0);
  r = U(r, vec2(chb(pt - vec3(0.0015, -0.002, 0.0), vec3(0.0165, 0.0165, 0.0315), 0.003, 0.0015), 13.0));        // the breech block
  r = U(r, vec2(max(sdCyl(s - vec3(0.0, 0.006, 0.143), 0.0155, 0.007) - 0.001, -sdCyl(s - vec3(0.0, 0.006, 0.15), 0.009, 0.02)), 13.0));
  r = U(r, vec2(scrX(vec3(abs(s.x) - 0.026, s.y + 0.014, s.z - 0.124), 0.0052), 13.0));
  r = U(r, vec2(sdRB(s - vec3(0.0, 0.046, 0.124), vec3(0.0045, 0.0075, 0.007), 0.0015), 12.0));
  r = U(r, vec2(length(s - vec3(0.0, 0.048, 0.1165)) - 0.0026, 20.0));
  r = U(r, vec2(max(sdRB(s - vec3(0.0, 0.047, -0.124), vec3(0.018, 0.0085, 0.008), 0.0015), -sdBx(s - vec3(0.0, 0.055, -0.124), vec3(0.0045, 0.0085, 0.012))), 12.0));
  r = U(r, vec2(length(vec3(abs(s.x) - 0.0105, s.y - 0.049, s.z + 0.1325)) - 0.0026, 13.0));
  r = U(r, vec2(min(fr, min(min(sdRB(vec3(abs(g.x) - 0.0235, g.y - 0.017, g.z + 0.05), vec3(0.003, 0.006, 0.009), 0.0015),
                               sdRB(vec3(abs(g.x) - 0.0235, g.y - 0.012, g.z - 0.045), vec3(0.003, 0.0055, 0.011), 0.0015)),
                           sdRB(vec3(abs(g.x) - 0.022, g.y + 0.012, g.z - 0.016), vec3(0.004, 0.009, 0.009), 0.002))), 12.0));
  r = U(r, vec2(cut(gd, max(abs(rep(t.y + 0.014, 0.0055, 2.0)) - 0.0012, 0.049 - t.z), 0.0012), 12.0));
  r = U(r, vec2(trig(g - vec3(0.0, -0.026, 0.046)), 13.0));
  r = U(r, vec2(gp, 12.0));
  vec3 pn = vec3(abs(h.x) - 0.0205, h.y + 0.004, h.z + 0.002);
  float pnl = sdRB(pn, vec3(0.0035, 0.052, 0.04), 0.005);
  pnl = cut(pnl, max(abs(pn.y + 0.004) - 0.0011, -pn.z - 0.032), 0.0012);                                          // a line across it
  r = U(r, vec2(pnl, 27.0));
  r = U(r, vec2(min(scrX(vec3(pn.x - 0.0035, pn.y - 0.032, pn.z - 0.012), 0.0058), scrX(vec3(pn.x - 0.0035, pn.y + 0.034, pn.z + 0.012), 0.0058)), 28.0));
  r = U(r, vec2(chb(h - vec3(0.0, -0.07, 0.002), vec3(0.025, 0.011, 0.056), 0.004, 0.0015), 12.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 2
// the pump shotgun: a bevelled receiver (three slots at the back, a steel port plate, an orange marker, a rear sight with an orange
// insert, screws); a big steel barrel, bored, with a steel collar, a muzzle ring and an orange-tipped front sight; the dark magazine
// tube (a steel ring, a knurled cap); a dark clamp round both; the ribbed orange pump; an orange grip (grooves, a screw, a dark cap)
vec2 gShotgun(vec3 g){
  vec3 rc = g - vec3(0.0, 0.05, 0.06), b = g - vec3(0.0, 0.075, 0.315), mt = g - vec3(0.0, 0.013, 0.295), pm = g - vec3(0.0, 0.01, 0.25 - u_pump * 0.05);
  vec3 h = g - vec3(0.0, -0.05, -0.04); h.yz = rot(-0.48) * h.yz; vec3 t = g - vec3(0.0, -0.022, 0.05);
  float rcv = chb(rc, vec3(0.034, 0.052, 0.115), 0.01, 0.002), br = sdCyl(b, 0.033, 0.175), tube = sdCyl(mt, 0.024, 0.145);
  float pump = sdRB(pm, vec3(0.039, 0.036, 0.076), 0.017), gp = chb(h, vec3(0.022, 0.056, 0.032), 0.008, 0.002), gd = tgd(t, vec2(0.04, 0.026), vec2(0.029, 0.019));
  float d0 = min(min(min(rcv, br), min(tube, pump)), min(gp, gd)); if (d0 > 0.03) return vec2(d0 - 0.022, 12.0);
  rcv = cut(rcv, max(abs(rep(rc.z + 0.085, 0.013, 1.0)) - 0.0035, abs(rc.y - 0.006) - 0.024), 0.006);
  rcv = smax(rcv, -sdBx(vec3(abs(rc.x) - 0.034, rc.y - 0.013, rc.z - 0.018), vec3(0.004, 0.017, 0.037)), 0.0015);
  vec2 r = vec2(rcv, 12.0);
  r = U(r, vec2(sdRB(vec3(abs(rc.x) - 0.0315, rc.y - 0.013, rc.z - 0.018), vec3(0.003, 0.0155, 0.035), 0.002), 13.0));
  r = U(r, vec2(sdRB(g - vec3(0.0, 0.103, 0.13), vec3(0.008, 0.004, 0.007), 0.0015), 27.0));
  r = U(r, vec2(sdRB(g - vec3(0.0, 0.11, -0.025), vec3(0.012, 0.011, 0.016), 0.003), 12.0));
  r = U(r, vec2(sdRB(g - vec3(0.0, 0.123, -0.025), vec3(0.0075, 0.0035, 0.009), 0.0015), 27.0));
  r = U(r, vec2(scrX(vec3(abs(rc.x) - 0.034, abs(rc.y + 0.004) - 0.032, rc.z + 0.098), 0.004), 28.0));
  br = max(br, -sdCyl(b - vec3(0.0, 0.0, 0.175), 0.025, 0.03));
  r = U(r, vec2(br, 13.0));
  r = U(r, vec2(sdCyl(b - vec3(0.0, 0.0, -0.135), 0.037, 0.009) - 0.001, 12.0));
  r = U(r, vec2(max(sdCyl(b - vec3(0.0, 0.0, 0.168), 0.036, 0.008), -sdCyl(b - vec3(0.0, 0.0, 0.175), 0.025, 0.03)), 28.0));
  r = U(r, vec2(sdRB(b - vec3(0.0, 0.039, 0.145), vec3(0.0035, 0.007, 0.006), 0.0015), 12.0));
  r = U(r, vec2(sdRB(b - vec3(0.0, 0.0465, 0.145), vec3(0.0036, 0.0025, 0.0062), 0.001), 27.0));
  r = U(r, vec2(tube, 12.0));
  r = U(r, vec2(sdCyl(mt - vec3(0.0, 0.0, 0.118), 0.0275, 0.011), 13.0));
  r = U(r, vec2(sdCyl(mt - vec3(0.0, 0.0, 0.153), 0.026, 0.012) - 0.001, 34.0));
  r = U(r, vec2(sdCyl(mt - vec3(0.0, 0.0, 0.166), 0.005, 0.003), 13.0));
  r = U(r, vec2(min(sdRB(vec3(g.x, g.y - 0.044, g.z - 0.35), vec3(0.039, 0.066, 0.009), 0.03), sdCyl(b - vec3(0.0, 0.0, 0.118), 0.037, 0.011)), 12.0));
  r = U(r, vec2(min(scrX(vec3(abs(g.x) - 0.039, g.y - 0.044, g.z - 0.35), 0.0045), scrX(vec3(abs(b.x) - 0.037, b.y, b.z - 0.118), 0.004)), 28.0));
  r = U(r, vec2(cut(pump, max(abs(rep(pm.z + 0.0105, 0.021, 2.0)) - 0.0045, abs(pm.y) - 0.028), 0.0045), 27.0));   // six ribs
  r = U(r, vec2(cut(gp, max(abs(rep(h.y - 0.02, 0.013, 1.0)) - 0.0022, 0.016 - abs(h.x)), 0.003), 27.0));
  r = U(r, vec2(scrX(vec3(abs(h.x) - 0.022, h.y + 0.032, h.z + 0.008), 0.0045), 28.0));
  r = U(r, vec2(chb(h - vec3(0.0, -0.06, 0.003), vec3(0.024, 0.0095, 0.036), 0.004, 0.0015), 12.0));
  r = U(r, vec2(gd, 12.0));
  r = U(r, vec2(trig(g - vec3(0.0, -0.016, 0.042)), 13.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 3
// the SMG: a bevelled receiver (a panel line, three slots at the back, a steel plate with four screws, a slot by the front, corner
// screws), a dark rear cap with a slot, a rail of five teeth, an orange red-dot on its mount; an eight-sided collar, a steel shroud
// with two rows of oval ports and a bored ring; a black grip (raised panel, screw, plate); the orange magazine (four slots, screws)
vec2 gSmg(vec3 g){
  vec3 rc = g - vec3(0.0, 0.06, 0.1), b = g - vec3(0.0, 0.058, 0.33), t = g - vec3(0.0, -0.012, 0.062);
  vec3 h = g - vec3(0.0, -0.066, -0.05); h.yz = rot(-0.5) * h.yz;
  vec3 m = g - vec3(0.0, -0.066, 0.162); m.yz = rot(0.1) * m.yz;
  float rcv = chb(rc, vec3(0.034, 0.05, 0.125), 0.011, 0.002), cap = chb(g - vec3(0.0, 0.058, -0.04), vec3(0.03, 0.046, 0.02), 0.009, 0.002);
  float sh = sdCyl(b, 0.034, 0.075), col = max(polar(b.xy, 8.0).x - 0.044, abs(b.z + 0.083) - 0.012);
  float gp = chb(h, vec3(0.022, 0.068, 0.034), 0.01, 0.002), mg = chb(m, vec3(0.02, 0.075, 0.032), 0.006, 0.002);
  float rd = chb(g - vec3(0.0, 0.144, 0.045), vec3(0.025, 0.022, 0.033), 0.006, 0.002), gd = tgd(t, vec2(0.038, 0.026), vec2(0.027, 0.019));
  float d0 = min(min(min(rcv, cap), min(sh, col)), min(min(gp, mg), min(rd, gd))); if (d0 > 0.03) return vec2(d0 - 0.016, 12.0);
  rcv = cut(rcv, abs(rc.y + 0.024) - 0.0012, 0.0016);
  rcv = cut(rcv, max(abs(rep(rc.z + 0.093, 0.0135, 1.0)) - 0.0036, abs(rc.y - 0.01) - 0.019), 0.007);
  rcv = cut(rcv, sdB2(vec2(rc.z - 0.085, rc.y), vec2(0.016, 0.0001)) - 0.0042, 0.005);
  vec2 r = vec2(rcv, 12.0);
  vec3 pl = vec3(abs(rc.x) - 0.0345, rc.y - 0.014, rc.z);
  r = U(r, vec2(sdRB(pl, vec3(0.0025, 0.012, 0.033), 0.0015), 13.0));
  r = U(r, vec2(min(scrX(vec3(pl.x - 0.0015, abs(pl.y) - 0.0075, abs(pl.z) - 0.027), 0.0028), scrX(vec3(abs(rc.x) - 0.034, abs(rc.y + 0.004) - 0.033, abs(rc.z) - 0.112), 0.0042)), 28.0));
  r = U(r, vec2(cut(cap, max(abs(g.z + 0.04) - 0.0045, abs(g.y - 0.058) - 0.02), 0.006), 19.0));
  r = U(r, vec2(min(sdBx(g - vec3(0.0, 0.112, 0.15), vec3(0.014, 0.003, 0.048)), sdRB(vec3(g.x, g.y - 0.117, rep(g.z - 0.15, 0.019, 2.0)), vec3(0.016, 0.006, 0.0055), 0.0015)), 12.0));
  r = U(r, vec2(sdRB(g - vec3(0.0, 0.118, 0.045), vec3(0.017, 0.012, 0.024), 0.002), 12.0));
  r = U(r, vec2(smax(rd, -sdBx(g - vec3(0.0, 0.144, 0.084), vec3(0.018, 0.015, 0.012)), 0.002), 27.0));
  r = U(r, vec2(sdBx(g - vec3(0.0, 0.144, 0.074), vec3(0.018, 0.015, 0.003)), 31.0));
  r = U(r, vec2(scrX(vec3(abs(g.x) - 0.025, g.y - 0.144, g.z - 0.03), 0.0035), 28.0));
  r = U(r, vec2(col, 12.0));
  vec2 pp = polar(b.xy, 6.0); float bore = sdCyl(b - vec3(0.0, 0.0, 0.08), 0.014, 0.04);
  r = U(r, vec2(max(cut(sh, length(vec2(pp.y, max(abs(abs(b.z - 0.005) - 0.025) - 0.009, 0.0))) - 0.0062, 0.012), -bore), 28.0));   // oval ports
  vec2 b4 = polar(b.xy, 4.0); vec3 bk = b - vec3(0.0, 0.0, 0.07);                                                // the brake: a dark ring, four slots
  r = U(r, vec2(cut(max(sdCyl(bk, 0.036, 0.012) - 0.001, -bore), max(abs(b4.y) - 0.0042, abs(bk.z) - 0.0075), 0.012), 12.0));
  r = U(r, vec2(gp, 19.0));
  r = U(r, vec2(sdRB(vec3(abs(h.x) - 0.022, h.y + 0.008, h.z + 0.002), vec3(0.0025, 0.046, 0.025), 0.005), 19.0));
  r = U(r, vec2(scrX(vec3(abs(h.x) - 0.0245, h.y + 0.042, h.z + 0.012), 0.0042), 28.0));
  r = U(r, vec2(chb(h - vec3(0.0, -0.072, 0.008), vec3(0.025, 0.0095, 0.042), 0.005, 0.0015), 12.0));
  r = U(r, vec2(gd, 12.0));
  r = U(r, vec2(trig(g - vec3(0.0, -0.006, 0.055)), 13.0));
  float yy = m.y + 0.013; yy -= 0.026 * clamp(floor(yy / 0.026 + 0.5), -1.0, 2.0);
  r = U(r, vec2(cut(mg, max(sdB2(vec2(m.z, yy), vec2(0.011, 0.0028)) - 0.0012, 0.014 - abs(m.x)), 0.004), 27.0));
  r = U(r, vec2(scrX(vec3(abs(m.x) - 0.02, abs(m.y) - 0.06, m.z + 0.014), 0.0035), 28.0));
  r = U(r, vec2(chb(m - vec3(0.0, -0.081, 0.0), vec3(0.023, 0.0085, 0.036), 0.004, 0.0015), 12.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 4
// the minigun: a big orange bevelled housing (a seam near the front, a dark vent plate with steel slats each side, corner screws,
// orange mounts for a big black handle), a dark motor drum at the back with side clamps, a tall olive ammo box under it (a lid seam,
// a slot); six thick spinning steel barrels, bored, round a spindle, through a dark eight-sided collar at the housing (a side lug),
// a middle clamp and a wide front clamp, all screwed
vec2 gMinigun(vec3 g){
  vec3 hs = g - vec3(0.0, 0.035, 0.04), bx = g - vec3(0.0, 0.035, 0.33);
  float hous = chb(hs, vec3(0.062, 0.068, 0.08), 0.018, 0.003), mot = sdCyl(g - vec3(0.0, 0.035, -0.058), 0.056, 0.018);
  float box = chb(g - vec3(0.0, -0.083, 0.035), vec3(0.058, 0.055, 0.068), 0.01, 0.003);
  vec3 hp = vec3(g.x, g.y - 0.124, abs(g.z - 0.04) - 0.056);
  float hd = min(sdRB(g - vec3(0.0, 0.155, 0.04), vec3(0.017, 0.017, 0.073), 0.008), sdRB(hp, vec3(0.017, 0.024, 0.017), 0.008));
  float d0 = min(min(hous, mot), min(min(box, hd), sdCyl(bx, 0.072, 0.21))); if (d0 > 0.03) return vec2(d0 - 0.012, 12.0);
  hous = cut(hous, abs(hs.z - 0.052) - 0.0012, 0.0018);                                                            // the seam
  vec3 vp = vec3(abs(hs.x) - 0.062, hs.y + 0.004, hs.z + 0.006); float inner = sdRB(vp, vec3(0.006, 0.022, 0.04), 0.004);
  vec2 r = vec2(smax(hous, -inner, 0.002), 27.0);
  r = U(r, vec2(max(sdRB(vp, vec3(0.0035, 0.029, 0.047), 0.006), -sdRB(vp - vec3(0.002, 0.0, 0.0), vec3(0.004, 0.022, 0.04), 0.004)), 12.0));
  r = U(r, vec2(max(sdBx(vec3(vp.x + 0.003, vp.y, rep(vp.z + vp.y * 0.6, 0.018, 2.0)), vec3(0.002, 0.03, 0.005)), inner), 13.0));
  r = U(r, vec2(min(scrX(vec3(abs(hs.x) - 0.062, abs(hs.y) - 0.054, abs(hs.z + 0.006) - 0.06), 0.005),
                    scrX(vec3(abs(vp.x) - 0.0035, abs(vp.y) - 0.022, abs(vp.z) - 0.04), 0.0032)), 28.0));
  r = U(r, vec2(chb(vec3(g.x, g.y - 0.107, abs(g.z - 0.04) - 0.056), vec3(0.024, 0.01, 0.022), 0.005, 0.0015), 27.0));
  r = U(r, vec2(scrX(vec3(abs(g.x) - 0.024, g.y - 0.107, abs(g.z - 0.04) - 0.064).yxz, 0.0045), 28.0));
  r = U(r, vec2(hd, 29.0));
  r = U(r, vec2(min(min(mot, sdCyl(g - vec3(0.0, 0.035, -0.08), 0.044, 0.007)), sdRB(vec3(abs(g.x) - 0.056, g.y - 0.035, g.z + 0.058), vec3(0.008, 0.016, 0.014), 0.002)), 12.0));
  float bx2 = cut(box, abs(g.y + 0.05) - 0.0013, 0.0018);                                                         // the lid seam
  bx2 = cut(bx2, max(abs(g.z - 0.035) - 0.0013, -g.y - 0.05), 0.0018);
  r = U(r, vec2(cut(bx2, max(sdB2(vec2(g.z - 0.012, g.y + 0.04), vec2(0.016, 0.0001)) - 0.0028, 0.05 - abs(g.x)), 0.003), 15.0));
  vec3 sp = bx; sp.xy = rot(u_spin) * sp.xy; vec2 pr = polar(sp.xy, 6.0); vec3 bb = vec3(pr.x - 0.04, pr.y, bx.z);
  r = U(r, vec2(max(sdCyl(bb, 0.018, 0.2), -sdCyl(bb - vec3(0.0, 0.0, 0.2), 0.0095, 0.02)), 13.0));
  r = U(r, vec2(sdCyl(bx, 0.024, 0.195), 12.0));
  vec2 p8 = polar(sp.xy, 8.0), p4 = polar(sp.xy, 4.0), q8 = polar(bx.xy, 8.0);
  float cr = min(min(max(q8.x - 0.07, abs(bx.z + 0.19) - 0.018), max(p8.x - 0.066, abs(bx.z + 0.03) - 0.013)), max(p8.x - 0.069, abs(bx.z - 0.165) - 0.022));
  r = U(r, vec2(cr, 12.0));
  r = U(r, vec2(sdRB(vec3(abs(bx.x) - 0.07, bx.y, bx.z + 0.19), vec3(0.009, 0.017, 0.015), 0.002), 12.0));
  r = U(r, vec2(min(min(length(vec3(p4.x - 0.069, p4.y, bx.z - 0.165)) - 0.0062, length(vec3(p4.x - 0.066, p4.y, bx.z + 0.03)) - 0.0058),
                    length(vec3(polar(bx.xy, 4.0).x - 0.07, polar(bx.xy, 4.0).y, bx.z + 0.19)) - 0.006), 13.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 5
// the sniper rifle: a tall bevelled receiver (three slots, a steel plate, a panel line, screws), a dark stock block with a step on
// top, a dark collar, a tall tan handguard (two slots a side, a screw), a dark barrel with a ported brake; a scope with a ribbed
// eyepiece, a big objective with an orange band and a blue lens, two rings on bases and a turret with an orange ring; a raked black
// grip with panels; the long orange magazine with slots
vec2 gSniper(vec3 g){
  vec3 rc = g - vec3(0.0, 0.05, 0.06), sc = g - vec3(0.0, 0.152, 0.07), hg = g - vec3(0.0, 0.038, 0.27), m = g - vec3(0.0, -0.06, 0.095), t = g - vec3(0.0, -0.024, 0.028);
  vec3 h = g - vec3(0.0, -0.075, -0.038); h.yz = rot(-0.42) * h.yz;
  float rcv = chb(rc, vec3(0.032, 0.058, 0.135), 0.011, 0.002), stk = chb(g - vec3(0.0, 0.052, -0.11), vec3(0.03, 0.062, 0.034), 0.011, 0.002);
  float hgd = chb(hg, vec3(0.034, 0.048, 0.074), 0.013, 0.002), br = sdCyl(g - vec3(0.0, 0.04, 0.522), 0.015, 0.178), mb = sdRB(g - vec3(0.0, 0.04, 0.735), vec3(0.021, 0.021, 0.04), 0.008);
  float scope = min(sdCyl(sc, 0.022, 0.13), min(sdCyl(sc + vec3(0.0, 0.0, 0.118), 0.04, 0.026), sdCyl(sc - vec3(0.0, 0.0, 0.124), 0.045, 0.03)));
  float gp = chb(h, vec3(0.023, 0.068, 0.034), 0.009, 0.002), mg = chb(m, vec3(0.021, 0.076, 0.038), 0.006, 0.002), gd = tgd(t, vec2(0.034, 0.022), vec2(0.024, 0.015));
  float d0 = min(min(min(rcv, stk), min(hgd, br)), min(min(mb, scope), min(min(gp, mg), gd))); if (d0 > 0.03) return vec2(d0 - 0.024, 12.0);
  rcv = cut(rcv, max(abs(rep(rc.z + 0.098, 0.014, 1.0)) - 0.0038, abs(rc.y - 0.008) - 0.024), 0.006);
  rcv = cut(rcv, max(abs(rc.y + 0.03) - 0.0012, rc.z + 0.12), 0.0016);
  vec2 r = vec2(rcv, 12.0);
  r = U(r, vec2(sdRB(vec3(abs(rc.x) - 0.0325, rc.y - 0.016, rc.z - 0.012), vec3(0.0025, 0.012, 0.03), 0.0015), 13.0));
  r = U(r, vec2(scrX(vec3(abs(rc.x) - 0.032, abs(rc.y - 0.004) - 0.04, abs(rc.z) - 0.118), 0.0045), 28.0));
  r = U(r, vec2(cut(stk, abs(g.z + 0.11) - 0.002, 0.002), 19.0));
  r = U(r, vec2(chb(g - vec3(0.0, 0.122, -0.078), vec3(0.013, 0.012, 0.017), 0.004, 0.0015), 12.0));
  r = U(r, vec2(chb(g - vec3(0.0, 0.04, 0.198), vec3(0.035, 0.05, 0.01), 0.006, 0.0015), 12.0));
  r = U(r, vec2(scrX(vec3(abs(g.x) - 0.035, abs(g.y - 0.04) - 0.03, g.z - 0.198), 0.0045), 28.0));
  float hgc = cut(hgd, max(sdB2(vec2(hg.z + 0.018, hg.y - 0.016), vec2(0.024, 0.0001)) - 0.0075, 0.026 - abs(hg.x)), 0.014);
  r = U(r, vec2(cut(hgc, max(sdB2(vec2(hg.z - 0.012, hg.y + 0.018), vec2(0.022, 0.0001)) - 0.0075, 0.026 - abs(hg.x)), 0.014), 18.0));
  r = U(r, vec2(scrX(vec3(abs(hg.x) - 0.034, hg.y - 0.016, hg.z - 0.046), 0.0045), 28.0));
  r = U(r, vec2(sdCyl(g - vec3(0.0, 0.04, 0.352), 0.023, 0.009), 12.0));
  r = U(r, vec2(br, 28.0));
  vec3 q = g - vec3(0.0, 0.04, 0.735);
  r = U(r, vec2(max(max(mb, -sdBx(q - vec3(0.0, 0.0, 0.01), vec3(0.03, 0.007, 0.011))), -sdCyl(q, 0.0085, 0.06)), 12.0));
  r = U(r, vec2(sdCyl(sc, 0.022, 0.13), 12.0));
  vec3 ey = sc + vec3(0.0, 0.0, 0.118);
  r = U(r, vec2(cut(sdCyl(ey, 0.04, 0.026), max(abs(rep(ey.z, 0.0085, 2.0)) - 0.002, 0.036 - length(ey.xy)), 0.003), 29.0));
  vec3 ob = sc - vec3(0.0, 0.0, 0.124);
  r = U(r, vec2(max(sdCyl(ob, 0.045, 0.03), -sdCyl(ob - vec3(0.0, 0.0, 0.034), 0.036, 0.012)), 12.0));
  r = U(r, vec2(max(sdCyl(ob + vec3(0.0, 0.0, 0.006), 0.0462, 0.007), -sdCyl(ob, 0.036, 0.1)), 27.0));
  r = U(r, vec2(sdCyl(ob - vec3(0.0, 0.0, 0.019), 0.036, 0.002), 24.0));
  vec3 rq = vec3(sc.x, sc.y, abs(sc.z - 0.03) - 0.056);
  r = U(r, vec2(min(sdCyl(rq, 0.029, 0.011), sdRB(rq + vec3(0.0, 0.034, 0.0), vec3(0.014, 0.02, 0.01), 0.003)), 12.0));
  r = U(r, vec2(scrX(vec3(abs(rq.x) - 0.029, rq.y, rq.z), 0.0045), 28.0));
  vec3 tu = sc - vec3(0.0, 0.031, 0.03);
  r = U(r, vec2(cylY(tu, 0.013, 0.009), 12.0));
  r = U(r, vec2(cylY(tu - vec3(0.0, 0.01, 0.0), 0.0185, 0.004), 27.0));
  r = U(r, vec2(cylY(tu - vec3(0.0, 0.02, 0.0), 0.0135, 0.008), 34.0));
  r = U(r, vec2(gp, 19.0));
  r = U(r, vec2(sdRB(vec3(abs(h.x) - 0.023, rep(h.y + 0.004, 0.032, 1.0), h.z + 0.002), vec3(0.0025, 0.0125, 0.024), 0.004), 19.0));
  r = U(r, vec2(chb(h - vec3(0.0, -0.072, 0.005), vec3(0.025, 0.009, 0.039), 0.004, 0.0015), 12.0));
  float yy = m.y + 0.008; yy -= 0.025 * clamp(floor(yy / 0.025 + 0.5), -1.0, 1.0);
  r = U(r, vec2(cut(mg, max(sdB2(vec2(m.z, yy), vec2(0.017, 0.003)) - 0.0012, 0.016 - abs(m.x)), 0.004), 27.0));
  r = U(r, vec2(chb(m - vec3(0.0, -0.082, 0.0), vec3(0.024, 0.009, 0.042), 0.004, 0.0015), 12.0));
  r = U(r, vec2(gd, 12.0));
  r = U(r, vec2(trig(g - vec3(0.0, -0.018, 0.026)), 13.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 6
// the flamethrower: a bevelled body (a dark vent plate with three slots each side), a steel valve stem with a red handwheel; the
// dark tube, a steel clamp ring, a perforated steel heat shield (a shell over the tube), a dark ring, the slotted steel nozzle with a
// brass igniter pin inside; the red tank (dark caps, the front one marked with a triangle, two wide steel straps with slotted
// buckles and brackets up to the tube); a black hose with steel fittings down the right side into the tank; a black grip, a red trigger
vec2 gFlame(vec3 g){
  vec3 bd = g - vec3(0.0, 0.05, 0.01), tb = g - vec3(0.0, 0.05, 0.13), sh = g - vec3(0.0, 0.05, 0.265), nz = g - vec3(0.0, 0.05, 0.415), tk = g - vec3(0.0, -0.072, 0.215);
  vec3 h = g - vec3(0.0, -0.07, -0.025); h.yz = rot(-0.3) * h.yz; vec3 vv = g - vec3(0.0, 0.1, -0.012);
  float body = chb(bd, vec3(0.04, 0.05, 0.07), 0.012, 0.002), shield = sdCyl(sh, 0.057, 0.075), noz = sdCyl(nz, 0.05, 0.055), tank = sdCyl(tk, 0.06, 0.15);
  float gp = chb(h, vec3(0.022, 0.07, 0.034), 0.008, 0.002), valve = length(vv - vec3(0.0, 0.03, 0.0)) - 0.034;
  float d0 = min(min(min(body, sdCyl(tb, 0.046, 0.06)), min(shield, noz)), min(min(tank, gp), valve)); if (d0 > 0.03) return vec2(d0 - 0.014, 12.0);
  vec3 vp = vec3(abs(bd.x) - 0.04, bd.y - 0.008, bd.z + 0.025);
  vec2 r = vec2(smax(body, -sdRB(vp, vec3(0.005, 0.02, 0.022), 0.004), 0.002), 12.0);
  r = U(r, vec2(cut(sdRB(vp + vec3(0.002, 0.0, 0.0), vec3(0.0035, 0.019, 0.021), 0.004), max(abs(rep(vp.z, 0.009, 1.0)) - 0.0022, abs(vp.y) - 0.012), 0.004), 19.0));
  r = U(r, vec2(scrX(vec3(abs(bd.x) - 0.04, abs(bd.y - 0.008) - 0.026, bd.z + 0.025), 0.0035), 28.0));
  r = U(r, vec2(min(cylY(vv - vec3(0.0, 0.012, 0.0), 0.008, 0.014), max(polar(vv.xz, 6.0).x - 0.012, abs(vv.y - 0.004) - 0.005)), 13.0));
  vec3 wh = vv - vec3(0.0, 0.032, 0.0); vec2 s4 = polar(wh.xz, 4.0);
  r = U(r, vec2(min(min(length(vec2(length(wh.xz) - 0.027, wh.y)) - 0.0055, max(max(abs(s4.y) - 0.0035, abs(wh.y) - 0.003), s4.x - 0.027)), cylY(wh, 0.008, 0.005)), 16.0));
  r = U(r, vec2(min(sdCyl(tb, 0.04, 0.06), sdCyl(sh, 0.041, 0.08)), 12.0));
  r = U(r, vec2(sdCyl(tb - vec3(0.0, 0.0, 0.054), 0.046, 0.007), 13.0));
  float ang = atan(sh.y, sh.x), si = floor(ang / 0.5236 + 0.5); vec2 ph = polar(sh.xy, 12.0);
  float shell = max(shield, -sdCyl(sh, 0.049, 0.1));
  shell = max(shell, -(length(vec2(ph.y, rep(sh.z + mod(si, 2.0) * 0.011, 0.022, 3.0))) - 0.0062));
  r = U(r, vec2(shell, 13.0));
  r = U(r, vec2(sdCyl(sh - vec3(0.0, 0.0, 0.08), 0.06, 0.009), 12.0));
  vec2 n4 = polar(nz.xy, 4.0);
  r = U(r, vec2(cut(max(noz, -sdCyl(nz - vec3(0.0, 0.0, 0.02), 0.04, 0.06)), max(abs(n4.y) - 0.008, abs(nz.z - 0.03) - 0.012), 0.012), 13.0));
  r = U(r, vec2(sdCyl(nz - vec3(0.0, 0.0, 0.02), 0.006, 0.026), 20.0));
  r = U(r, vec2(tank, 16.0));
  float caps = sdCyl(vec3(tk.xy, abs(tk.z) - 0.152), 0.056, 0.012) - 0.004;
  r = U(r, vec2(cut(caps, max(abs(sdTri(tk.xy - vec2(0.0, -0.004), 0.019)) - 0.0018, 0.16 - tk.z), 0.0022), 12.0));
  vec3 st = vec3(tk.xy, abs(tk.z) - 0.065);
  r = U(r, vec2(min(sdCyl(st, 0.0645, 0.014), sdRB(st - vec3(0.0, 0.07, 0.0), vec3(0.018, 0.02, 0.013), 0.003)), 13.0));
  vec3 bk = vec3(abs(st.x) - 0.066, st.y + 0.006, st.z);
  r = U(r, vec2(max(sdRB(bk, vec3(0.006, 0.022, 0.017), 0.002), -sdBx(bk - vec3(0.005, 0.0, 0.0), vec3(0.004, 0.011, 0.007))), 12.0));
  vec3 a0 = vec3(-0.04, 0.018, 0.064), a1 = vec3(-0.056, 0.004, 0.074), a2 = vec3(-0.058, -0.018, 0.086), a3 = vec3(-0.043, -0.036, 0.1);
  r = U(r, vec2(min(min(seg(g, a0, a1, 0.013), seg(g, a1, a2, 0.013)), seg(g, a2, a3, 0.013)), 29.0));
  r = U(r, vec2(min(seg(g, a0 - normalize(a1 - a0) * 0.006, a0 + normalize(a1 - a0) * 0.008, 0.0145), seg(g, a3 - normalize(a3 - a2) * 0.01, a3, 0.0145)), 13.0));
  r = U(r, vec2(gp, 19.0));
  r = U(r, vec2(sdRB(vec3(abs(h.x) - 0.022, rep(h.y + 0.005, 0.028, 1.0), h.z + 0.002), vec3(0.0025, 0.011, 0.024), 0.004), 19.0));
  r = U(r, vec2(trig(g - vec3(0.0, -0.016, 0.03)), 16.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 7
// the rocket launcher: an olive tube (oval slots, hollow at the back) behind a dark eight-sided flange; dark rings (blocks on the
// first, screws on the second), a front collar; yellow bands; the warhead's red nose with a dark tip; two grips under it, two
// sight posts on top
vec2 gRocket(vec3 g){
  vec2 p8 = polar(g.xy, 8.0);
  float tube = sdCyl(g - vec3(0.0, 0.0, 0.272), 0.08, 0.465);
  float fl = max(min(max(p8.x - 0.108, abs(g.z + 0.25) - 0.034), sdCyl(g - vec3(0.0, 0.0, -0.205), 0.09, 0.012)), -(length(g.xy) - 0.066));
  vec3 hr = g - vec3(0.0, -0.165, -0.012); hr.yz = rot(-0.12) * hr.yz; vec3 hf = g - vec3(0.0, -0.162, 0.5); hf.yz = rot(-0.2) * hf.yz;
  float gr = min(chb(hr, vec3(0.02, 0.07, 0.03), 0.007, 0.002), chb(hf, vec3(0.018, 0.064, 0.027), 0.007, 0.002));
  float nose = sdCone(g - vec3(0.0, 0.0, 0.782), 0.042, 0.074, 0.018);
  float d0 = min(min(tube, fl), min(gr, nose)); if (d0 > 0.03) return vec2(d0 - 0.025, 12.0);
  tube = max(tube, -sdCyl(g - vec3(0.0, 0.0, -0.2), 0.062, 0.07));
  tube = cut(tube, max(sdB2(vec2(g.z + 0.135, g.y - 0.018), vec2(0.026, 0.0001)) - 0.01, 0.055 - abs(g.x)), 0.006);
  tube = cut(tube, max(sdB2(vec2(g.z - 0.27, g.y - 0.018), vec2(0.05, 0.0001)) - 0.011, 0.055 - abs(g.x)), 0.006);
  tube = min(tube, sdCyl(g - vec3(0.0, 0.0, -0.095), 0.0835, 0.007) - 0.001);                                   // a raised band
  vec2 r = vec2(tube, 15.0);
  r = U(r, vec2(fl, 12.0));
  float rings = min(min(sdCyl(g - vec3(0.0, 0.0, 0.13), 0.09, 0.045), sdCyl(g - vec3(0.0, 0.0, 0.425), 0.088, 0.03)), max(polar(g.xy, 8.0).x - 0.091, abs(g.z - 0.646) - 0.028));
  r = U(r, vec2(min(rings - 0.002, min(sdRB(vec3(abs(g.x) - 0.092, g.y, g.z - 0.13), vec3(0.006, 0.014, 0.016), 0.002),
                                     sdRB(g - vec3(0.0, 0.092, 0.15), vec3(0.012, 0.007, 0.016), 0.002))), 12.0));
  r = U(r, vec2(sdRB(vec3(abs(g.x) - 0.091, g.y, g.z - 0.646), vec3(0.005, 0.016, 0.014), 0.002), 12.0));
  r = U(r, vec2(scrX(vec3(abs(g.x) - 0.089, abs(g.y) - 0.04, g.z - 0.425), 0.0055), 28.0));
  r = U(r, vec2(min(sdCyl(g - vec3(0.0, 0.0, 0.567), 0.0812, 0.028), sdCyl(g - vec3(0.0, 0.0, 0.7), 0.0812, 0.024)), 21.0));
  r = U(r, vec2(nose, 16.0));
  r = U(r, vec2(length(g - vec3(0.0, 0.0, 0.826)) - 0.016, 12.0));
  r = U(r, vec2(min(sdRB(g - vec3(0.0, -0.088, -0.005), vec3(0.028, 0.014, 0.05), 0.004), sdRB(g - vec3(0.0, -0.088, 0.498), vec3(0.025, 0.013, 0.036), 0.004)), 12.0));
  r = U(r, vec2(cut(gr, abs(rep(hr.y + 0.01, 0.014, 2.0)) - 0.0022, 0.002), 19.0));
  r = U(r, vec2(scrX(vec3(abs(hr.x) - 0.02, hr.y + 0.045, hr.z), 0.0042), 28.0));
  r = U(r, vec2(scrX(vec3(abs(g.x) - 0.028, g.y + 0.088, g.z + 0.03), 0.0042), 28.0));
  vec3 sg = vec3(g.x, g.y - 0.1, g.z - 0.03), sf = vec3(g.x, g.y - 0.1, g.z - 0.395);
  float posts = min(max(sdRB(sg, vec3(0.011, 0.024, 0.02), 0.003), -sdBx(sg - vec3(0.0, 0.02, 0.0), vec3(0.004, 0.012, 0.03))), sdRB(sf, vec3(0.01, 0.022, 0.016), 0.003));
  r = U(r, vec2(posts, 12.0));
  r = U(r, vec2(min(scrX(vec3(abs(sg.x) - 0.011, sg.y + 0.004, sg.z), 0.0038), scrX(vec3(abs(sf.x) - 0.01, sf.y + 0.004, sf.z), 0.0035)), 28.0));
  return r;
}
#endif
#if !defined(GUN) || GUN == 8
vec2 gLaser(vec3 g){
  vec3 bd = g - vec3(0.0, 0.034, 0.06), e = g - vec3(0.0, 0.034, 0.25), cq = g - vec3(0.0, 0.092, 0.03);
  float sh0 = sdRB(bd, vec3(0.033, 0.04, 0.1), 0.022), em = sdCyl(e, 0.019, 0.09), cell = sdRB(g - vec3(0.0, 0.09, 0.03), vec3(0.016, 0.018, 0.045), 0.008);
  float gp = pgrip(g, 0.021), fg = sdRB(g - vec3(0.0, -0.045, 0.11), vec3(0.015, 0.04, 0.018), 0.008);
  float d0 = min(min(sh0, em), min(cell, min(gp, fg))); if (d0 > 0.036) return vec2(d0 - 0.022, 12.0);
  // the white shell: panel seams, glowing vent slits on top, a screen let into the left side, orange armour panels on both
  sh0 = cut(sh0, min(abs(bd.z - 0.082) - 0.0012, abs(bd.y + 0.012) - 0.0012), 0.0018);
  sh0 = cut(sh0, max(abs(rep(bd.x, 0.009, 1.0)) - 0.0022, max(abs(bd.z - 0.045) - 0.022, 0.02 - bd.y)), 0.005);
  sh0 = smax(sh0, -sdBx(bd - vec3(-0.034, 0.012, 0.0), vec3(0.004, 0.012, 0.03)), 0.002);
  vec2 r = vec2(sh0, 22.0);
  r = U(r, vec2(sdRB(bd - vec3(0.0, 0.03, 0.045), vec3(0.012, 0.004, 0.022), 0.002), 17.0));
  r = U(r, vec2(sdBx(bd - vec3(-0.0315, 0.012, 0.0), vec3(0.0015, 0.0105, 0.028)), 32.0));
  r = U(r, vec2(sdRB(vec3(abs(bd.x) - 0.034, bd.y + 0.016, bd.z - 0.01), vec3(0.003, 0.0085, 0.07), 0.003), 27.0));
  // the emitter: three glowing coils between heat-sink fins, three prongs round a glowing crystal behind a lens
  r = U(r, vec2(em, 12.0));
  r = U(r, vec2(sdTor(vec3(e.xy, rep(e.z, 0.05, 1.0)), 0.026, 0.007), 17.0));
  r = U(r, vec2(sdCyl(vec3(e.xy, rep(e.z + 0.025, 0.05, 1.0)), 0.0285, 0.0018), 13.0));
  vec2 pr = polar(e.xy, 3.0);
  r = U(r, vec2(sdRB(vec3(pr.x - 0.021, pr.y, e.z - 0.1), vec3(0.004, 0.0032, 0.018), 0.002), 12.0));
  r = U(r, vec2(sdCyl(e - vec3(0.0, 0.0, 0.093), 0.0165, 0.003), 24.0));
  vec3 cx = e - vec3(0.0, 0.0, 0.102); cx.xy = rot(0.785) * cx.xy;
  r = U(r, vec2(sdRB(cx, vec3(0.012, 0.012, 0.012), 0.004), 17.0));
  // the energy cell: its housing open on the left, the glowing core behind a glass window, steel end caps
  r = U(r, vec2(smax(cell, -sdBx(cq - vec3(-0.016, 0.0, 0.0), vec3(0.006, 0.01, 0.034)), 0.002), 12.0));
  r = U(r, vec2(sdCyl(cq, 0.0115, 0.036), 17.0));
  r = U(r, vec2(sdCyl(vec3(cq.xy, abs(cq.z) - 0.04), 0.0128, 0.004), 13.0));
  // the grip with finger grooves and an orange trigger; the ribbed front grip
  vec3 h = gripF(g);
  r = U(r, vec2(smax(gp, -(length(vec2(rep(h.y + 0.02, 0.019, 1.0), h.z - 0.0285)) - 0.0068), 0.004), 19.0));
  r = U(r, vec2(tblade(g - vec3(0.0, -0.009, 0.026)), 27.0));
  r = U(r, vec2(cut(fg, max(abs(rep(g.y + 0.045, 0.012, 2.0)) - 0.0022, abs(g.z - 0.11) - 0.01), 0.002), 19.0));
  return r;
}
#endif
// the shader comes in variants: GUN n builds in gun n only (0: none), ONLY leaves the penguin out (the menus); with neither, all
// eight (the DBG fitting tool). Every gun in one program made the shader compiler take many seconds.
vec2 gun(vec3 g){
#if defined(GUN) && GUN == 0
  return vec2(1e9, 12.0);
#else
  vec3 c = g; c.y -= u_gb.w; c.z -= clamp(c.z, u_gb.x, u_gb.y); float bd = length(c) - u_gb.z;
  if (bd > 0.04) return vec2(bd, 12.0);
  g /= u_gk; float sk = min(u_gk.x, min(u_gk.y, u_gk.z)); vec2 r;
#if !defined(GUN)
  int k = int(u_gun + 0.5);
  if (k == 1) r = gPistol(g); else if (k == 2) r = gShotgun(g); else if (k == 3) r = gSmg(g); else if (k == 4) r = gMinigun(g);
  else if (k == 5) r = gSniper(g); else if (k == 6) r = gFlame(g); else if (k == 7) r = gRocket(g); else r = gLaser(g);
#elif GUN == 1
  r = gPistol(g);
#elif GUN == 2
  r = gShotgun(g);
#elif GUN == 3
  r = gSmg(g);
#elif GUN == 4
  r = gMinigun(g);
#elif GUN == 5
  r = gSniper(g);
#elif GUN == 6
  r = gFlame(g);
#elif GUN == 7
  r = gRocket(g);
#else
  r = gLaser(g);
#endif
  return vec2(r.x * sk, r.y);
#endif
}
vec2 map(vec3 p){
  vec2 r = vec2(1e9, 0.0);
#ifndef ONLY
  if (u_only < 0.5) {
    r = body(u_Rb * (p - u_tb));
    r = U(r, vec2(foot(u_Rkl * (p - u_tkl)), 8.0)); r = U(r, vec2(foot(u_Rkr * (p - u_tkr)), 8.0));
    r = U(r, vec2(flipL(p), 25.0)); r = U(r, vec2(flipR(p), 26.0));
  }
#endif
  if (u_gun > 0.5) r = U(r, gun(u_Rg * (p - u_tg)));
  return r;
}
// a tap of the normal's tetrahedron (i = 0..3)
vec3 tet(int i){ return 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0); }
// chipped paint: flakes of the undercoat showing
float chips(vec3 b){ return smoothstep(0.69, 0.71, n3(b * 15.0) * 0.65 + n3(b * 43.0) * 0.35); }
// ---------- the guns' surfaces, patterned in the gun's own frame g ----------
// CURV: the curvature where the ray hit (1/radius, model units; + on edges, − in creases), from the normal's taps: paint wears off
// the edges in flakes and grime sits in the creases. The laser's screen and the red dot in the SMG's sight are paint.
float CURV = 0.0;
vec3 gunAlbedo(float m, vec3 g, int k, out float spec, out float glass, out float emit){
  spec = 0.3; glass = 0.0; emit = 0.0;
  // three noise calls in all (each is inlined whole): a broad one, and one whose frequency suits the material (brushed, flakes)
  vec3 fq = m > 12.5 && m < 13.5 ? vec3(240.0, 240.0, 9.0) : vec3(150.0);
  float gf = n3(g * 70.0) - 0.5, nq = n3(g * fq), edge = smoothstep(70.0, 260.0, CURV), cav = smoothstep(-40.0, -200.0, CURV);
  float wear = edge * (0.35 + 0.65 * smoothstep(0.42, 0.58, nq * 0.65 + (gf + 0.5) * 0.35)), dirt = 1.0 - 0.32 * cav;
  vec3 c;
  if (m < 12.5) { spec = 0.42 + 0.4 * wear; c = mix(GUNM * (1.0 + 0.06 * gf), STEEL * 1.08, wear * 0.8); }
  else if (m < 13.5) { spec = 0.8; c = STEEL * (0.92 + 0.14 * nq) * (1.0 + 0.25 * edge);
    if (k == 6 && g.z > 0.37) c *= mix(1.0, 0.35, smoothstep(0.4, 0.47, g.z)); }                                            // soot on the nozzle
  else if (m < 15.5) { spec = 0.14 + 0.3 * wear; c = mix(OLIVE * (1.0 + 0.05 * gf), GUNM * 1.1, wear * 0.75); }
  else if (m < 16.5) { spec = 0.32 + 0.3 * wear; c = mix(RED * (1.0 + 0.05 * gf), GUNM, wear * 0.7); }
  else if (m < 17.5) { emit = 0.85 + 0.15 * sin(u_t * 6.0 + g.z * 40.0); c = GLOW; }
  else if (m < 18.5) { spec = 0.18; c = mix(TAN * (1.0 + 0.05 * gf), TAN * 1.25, wear * 0.6); }
  else if (m < 19.5) { spec = 0.22; c = POLY * (1.0 + 0.08 * gf) + vec3(0.07) * edge; }
  else if (m < 20.5) { spec = 0.95; c = BRASS * (1.0 + 0.25 * edge); }
  else if (m < 21.5) { spec = 0.3; c = mix(YEL, GUNM, wear * 0.6); }
  else if (m < 22.5) { spec = 0.4; c = WHITE * (1.0 + 0.03 * gf); }
  else if (m < 24.5) { spec = 1.0; glass = 1.0; c = vec3(0.12, 0.3, 0.75); }
  else if (m < 27.5) { spec = 0.28 + 0.3 * wear; c = mix(ORANGE * (1.0 + 0.04 * gf), GUNM * 0.9, wear * 0.7); }
  else if (m < 28.5) { spec = 0.85; c = mix(BLUED * (1.0 + 0.05 * gf), STEEL, edge * 0.6); }
  else if (m < 29.5) { spec = 0.07; c = RUBB * (1.0 + 0.1 * gf); }
  else if (m < 31.5) { spec = 1.0; glass = 1.0; c = vec3(0.3, 0.12, 0.24);                                                     // red-dot lens and its dot
    if (length(g.xy - vec2(0.0, 0.142)) < 0.0032) { emit = 1.0; c = vec3(1.5, 0.15, 0.1); } }
  else if (m < 32.5) { emit = 1.0; vec2 q = vec2(g.z - 0.032, g.y - 0.046);                                                   // the laser's screen: a bar graph
    float col = floor(q.x / 0.0055), ht = 0.004 + 0.012 * h3(vec3(col, floor(u_t * 3.0), 1.0));
    c = GLOW * 0.25; if (fract(q.x / 0.0055) < 0.7 && q.y + 0.0105 < ht) c = GLOW * 0.9; if (abs(q.y - 0.0085) < 0.0012 && q.x > 0.02) c = ORANGE * 1.2; }
  else { spec = 0.55; c = STEEL * 0.78 * (1.0 + 0.2 * edge); }                                                                // knurled steel
  return c * dirt;
}
// relief too fine to model: stippled polymer and grips, rubber, knurling, brushed
// and cast metal — a height field whose gradient tilts the normal; it fades out once a stipple is smaller than a pixel
float bumpH(float m, vec3 g, int k){                                        // one noise call: its frequency and weight by material;
  vec3 f = vec3(1.0); float w = 0.0, x = 0.0;                                // knurling: crossed sines
  if (m > 18.5 && m < 19.5) { f = vec3(760.0); w = 1.0; }
  else if (m > 26.5 && m < 27.5) { f = vec3(180.0); w = 0.15; }
  else if (m > 28.5 && m < 29.5) { f = vec3(300.0); w = 0.6; }
  else if (m > 33.5) x = abs(sin((g.x + g.y + g.z) * 700.0)) * abs(sin((g.x - g.y + g.z) * 700.0));
  else if (m > 12.5 && m < 13.5) { f = vec3(900.0, 900.0, 25.0); w = 0.35; }
  else if (m > 21.5 && m < 22.5) { f = vec3(200.0); w = 0.12; }
  return n3(g * f) * w + x;
}
vec3 gunBump(float m, vec3 p, vec3 n){
  float a = (m > 33.5 ? 0.0011 : m > 28.5 && m < 29.5 ? 0.0005 : (m > 18.5 && m < 19.5) || (m > 26.5 && m < 27.5) ? 0.00045 : 0.0005) * smoothstep(0.0045, 0.0015, u_px);
  if (a <= 0.0) return n;
  vec3 g = u_Rg * (p - u_tg) / u_gk; int k = int(u_gun + 0.5); const float e = 0.0004; float h[4];
  for (int i = ZERO; i < 4; i++) h[i] = bumpH(m, g + e * vec3(float(i == 1), float(i == 2), float(i == 3)), k);   // one copy of bumpH, not four
  vec3 gr = (vec3(h[1], h[2], h[3]) - h[0]) / e;
  gr = (gr / u_gk) * u_Rg;                                                                       // to the world: dh/dp = Rt (dh/dg) / k
  return normalize(n - a * (gr - dot(gr, n) * n));
}
vec3 albedo(float m, vec3 p, out float spec, out float glass, out float emit){
  vec3 b = u_Rb * (p - u_tb); spec = 0.05; glass = 0.0; emit = 0.0;
  float fine = n3(b * 90.0) - 0.5;
  if (m < 1.5) { float f = (b.z / 0.92) / max(length(vec2(b.x, b.z / 0.92)), 1e-3); return mix(DARK, CREAM, smoothstep(0.28, 0.38, f)) * (1.0 + 0.04 * fine); }
  if (m > 24.5 && m < 26.5) { bool l = m < 25.5; vec3 qu = l ? u_Rul * (p - u_tul) : u_Rur * (p - u_tur), ql = l ? u_Rll * (p - u_tll) : u_Rlr * (p - u_tlr);
    float x = qu.y > -(l ? u_seg.x : u_seg.z) ? qu.x : ql.x;                                                       // in whichever segment
    return mix(DARK * (0.95 + 0.04 * fine), vec3(0.62, 0.58, 0.66), smoothstep(0.012, -0.02, x) * 0.55); }        // pale underneath, like a real penguin's
  if (m < 2.5) return DARK * (0.95 + 0.04 * fine);                                                                 // the tail
  if (m < 3.5) { spec = 0.22; vec3 c = abs(b.x) < 0.046 && b.y > 0.86 ? CREAM : ORANGE; return mix(c, CHIP, chips(b) * 0.85) * (1.0 + 0.03 * fine); }
  if (m < 4.5) { float a = atan(b.x, b.z); if (abs(a) < 0.7 && abs(b.y - 0.818) < 0.036 && length(b.xz) > gogR(b.y) + 0.014) { spec = 1.0; glass = 1.0;
      float v = (b.y - 0.818) / 0.036, stk = smoothstep(0.16, 0.0, abs(v * 0.55 - a * 0.9 - 0.15)) + 0.6 * smoothstep(0.07, 0.0, abs(v * 0.55 - a * 0.9 + 0.12));
      return LENS * (0.85 + 0.5 * smoothstep(-1.0, 1.0, v)) + vec3(0.9, 0.6, 0.35) * stk * 0.55; }                     // a sky gradient and two streaks
    spec = 0.25; return FRAME * (1.0 + 0.04 * fine); }
  if (m < 5.5) { float st = abs(b.y - 0.472) < 0.0025 && fract(atan(b.x, b.z) * 22.0) < 0.55 ? 1.25 : 1.0; return NAVY * st * (1.0 + 0.06 * fine); }   // stitching on the vest
  if (m < 6.5) return FEET * vec3(0.86, 0.9, 0.95);
  if (m < 7.5) { float g = abs(fract((b.x + 0.177) / 0.0885) - 0.5);                                        // segment seams, the X on the patch
    bool pt = abs(b.y - 0.41) < 0.037 && abs(b.x) < 0.05 && b.z > 0.0; float x = pt ? abs(abs(b.x) * 0.75 - abs(b.y - 0.41)) : 1.0;
    bool row = b.z > 0.06 && b.y < 0.37 && b.y > 0.22;
    spec = 0.12; return GREY * (row && g > 0.45 ? 0.62 : 1.0) * (pt && (x < 0.005 || abs(b.x) > 0.04 || abs(b.y - 0.41) > 0.03) ? 0.6 : 1.0); }
  if (m < 8.5) return FEET;
  if (m < 9.5) { spec = 0.15; return mix(ORANGE, CHIP, chips(b) * 0.85) * (1.0 + 0.03 * fine); }
  if (m < 10.5) { spec = 0.8; vec2 e = vec2(b.x - sign(b.x) * 0.12, b.y - 0.663);                           // the catchlights
    if (u_blink > 0.6 && (length(e - vec2(-0.011, 0.013)) < 0.0105 || length(e - vec2(0.01, -0.011)) < 0.005)) return vec3(1.6); return EYE; }
  if (m < 11.5) { spec = 0.2; return FEET * vec3(1.0, 1.12, 1.18); }
  return gunAlbedo(m, u_Rg * (p - u_tg) / u_gk, int(u_gun + 0.5), spec, glass, emit);              // the gun
}
vec2 sph(vec3 ro, vec3 rd, vec4 S){ vec3 oc = ro - S.xyz; float b = dot(oc, rd), c = dot(oc, oc) - S.w, h = b * b - c; if (S.w <= 0.0 || h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
void main(){
  vec2 d = (v_px - u_anchor) / u_s;
  float ce = cos(u_elev), se = sin(u_elev);
  vec3 fw = vec3(0.0, -se, -ce), up = vec3(0.0, ce, -se);
  vec3 ro = vec3(d.x, 0.0, 0.0) - up * d.y - fw * 3.0, rd = fw;                                          // start well in front of the model
  vec2 i1 = sph(ro, rd, u_bound), i2 = sph(ro, rd, u_bound2);                                            // bounds: the body's sphere, the gun's
  float t = min(i1.x, i2.x), t1 = max(i1.y, i2.y);
  vec4 bg = u_bg;
  if (t > t1) {
#ifdef LAYER
    discard;
#endif
    o = bg.a > 0.0 ? vec4(bg.rgb, 1.0) : vec4(0.0); return; }
#ifdef DBG
  {                                                                                                        // red where a flipper or the gun sinks into the body
    float pen = 0.0;
    for (int i = ZERO; i < 180; i++) { vec3 p = ro + rd * mix(t, t1, (float(i) + 0.5) / 180.0);
      if (body(u_Rb * (p - u_tb)).x < -0.008) {                                                          // a real overlap, not a touch;
        float fl = min(flipL(p) + step(length(p - u_tul), 0.13) * 9.0, flipR(p) + step(length(p - u_tur), 0.13) * 9.0);   // the shoulder joint itself excepted
        float gd = u_gun > 0.5 ? gun(u_Rg * (p - u_tg)).x : 1.0;
        if (min(fl, gd) < -0.015) { pen = 1.0; break; } } }
    o = vec4(pen, 0.0, 0.0, pen); return;
  }
#endif
  // one loop, one call of map: every call site of map is inlined whole (the penguin and all eight guns), which made the shader
  // take seconds to compile; so the march, the four normal taps and the five occlusion taps share it, phase by phase
  float md = 1e9, tmd = t, ao = 0.0, aw = 1.0, cv = 0.0, dh = 0.0; vec2 hit = vec2(-1.0); vec3 p = ro, n = vec3(0.0), q = ro + rd * t; int ph = 0, j = 0, steps = 0;
  for (int i = ZERO; i < 160; i++) {
    vec2 r = map(q);
    if (ph == 0) {                                                                                       // march
      if (r.x < md) { md = r.x; tmd = t; }
      if (r.x < u_px * 0.3) { hit = vec2(t, r.y); p = q; dh = r.x; ph = 1; j = 0; q = p + tet(0) * 0.0012; continue; }
      t += max(r.x, u_px * 0.25); steps++; if (t > t1 || steps >= 140) break; q = ro + rd * t;
    } else if (ph == 1) {                                                                                // the normal (and the taps' sum: curvature)
      n += tet(j) * r.x; cv += r.x; j++;
      if (j < 4) q = p + tet(j) * 0.0012; else { n = normalize(n); ph = 2; j = 1; q = p + n * 0.014; }
    } else {                                                                                             // occlusion
      ao += (0.014 * float(j) - r.x) * aw; aw *= 0.62; j++; if (j > 5) break; q = p + n * 0.014 * float(j);
    }
  }
  ao = clamp(1.0 - 3.0 * ao, 0.0, 1.0);
  CURV = (cv - 4.0 * dh) * 520833.3;                                                                       // 3 / (4 h²): 1/radius
  vec3 col; float a;
  if (hit.x > 0.0) {
    if (hit.y > 11.5 && (hit.y < 24.5 || hit.y > 26.5)) n = gunBump(hit.y, p, n);
    float sp, gl, em; vec3 al = albedo(hit.y, p, sp, gl, em), L = normalize(vec3(-0.6, 0.75, 0.45));
    float ndl = dot(n, L), dif = smoothstep(-0.55, 0.85, ndl), sky = 0.5 + 0.5 * n.y, nv = clamp(dot(n, -rd), 0.0, 1.0);
    vec3 lin = vec3(1.0, 0.9, 0.78) * dif + vec3(0.44, 0.46, 0.68) * sky * 0.55 + vec3(0.45, 0.33, 0.26) * (1.0 - sky) * 0.6;
    col = al * lin * (0.38 + 0.62 * ao);
    col += vec3(0.5, 0.52, 0.8) * pow(1.0 - nv, 3.0) * 0.2 * ao;                                          // cool rim
    col += vec3(1.0, 0.84, 0.6) * pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), mix(14.0, 70.0, sp)) * sp * 0.9;   // warm highlight
    if (gl > 0.5) col = mix(col, al, 0.6) + vec3(0.6, 0.75, 1.0) * pow(1.0 - nv, 2.0) * 0.25;                // glass: its own gradient and streaks, a cool rim
    col = mix(col, al, em);                                                                                // glow ignores the light
    col = mix(col, INK, smoothstep(0.2, 0.0, nv) * 0.45 * (1.0 - em));                                     // soft inked edge
    a = 1.0;
  } else {                                                                                                 // the 1.5 px outline + AA
    a = 1.0 - smoothstep(0.6 * u_px, 1.8 * u_px, md); col = INK;
  }
  if (u_lit > 0.5) { vec3 Lm = texture(u_light, LUV).rgb; Lm = min(Lm, vec3(1.0)) + max(Lm - 1.0, 0.0) * 0.3; col *= mix(vec3(1.0), Lm, u_lk); }
  col = mix(col, vec3(1.0), u_flash);
#ifdef LAYER
  if (a < 0.004) discard;
  gl_FragDepth = clamp((dot(ro + rd * (hit.x > 0.0 ? hit.x : tmd), fw) / 4.0 + 1.0) * 0.5, 0.0, 1.0);   // gunmesh.js's depth
#endif
  if (bg.a > 0.0) { o = vec4(mix(bg.rgb, col, a), 1.0); return; }
  a *= u_alpha; o = vec4(col * a, a);
}`;

  // ---------------- pose (JS): 3x3 rotations are row-major arrays of rows, part -> world ----------------
  const cos = Math.cos,
    sin = Math.sin,
    TAU = Math.PI * 2,
    clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rotX = (a) => [
    [1, 0, 0],
    [0, cos(a), -sin(a)],
    [0, sin(a), cos(a)],
  ];
  const rotY = (a) => [
    [cos(a), 0, sin(a)],
    [0, 1, 0],
    [-sin(a), 0, cos(a)],
  ];
  const rotZ = (a) => [
    [cos(a), -sin(a), 0],
    [sin(a), cos(a), 0],
    [0, 0, 1],
  ];
  const rotAxis = (k, a) => {
    const [x, y, z] = k,
      c = cos(a),
      s = sin(a),
      C = 1 - c;
    return [
      [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
      [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
      [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ];
  };
  const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const mv = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const mtv = (A, v) => [0, 1, 2].map((j) => A[0][j] * v[0] + A[1][j] * v[1] + A[2][j] * v[2]); // the transpose times v (world -> part)
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len = (a) => Math.sqrt(dot(a, a)),
    nz = (a) => mul(a, 1 / (len(a) || 1));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const flat = (R) => [...R[0], ...R[1], ...R[2]]; // rows of part->world = the GLSL mat3 world->part
  const cols = (x, y, z) => [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
  const ELEV = Math.PI / 6;
  // model point (world, origin at the hero's feet) -> screen offset in px
  PG.project = (w, s, e = ELEV) => [w[0] * s, (-w[1] * cos(e) + w[2] * sin(e)) * s];
  PG.ELEV = ELEV;
  const SH = [0.235, 0.5],
    L1 = 0.18,
    L2 = 0.18,
    A = 0.16,
    DUTY = 0.48; // shoulder radius & height; flipper segments; stride ±A, stance share
  PG.STEP = A / DUTY; // model units of ground travel per step
  PG.GUNS = ['pistol', 'shotgun', 'smg', 'minigun', 'sniper', 'flame', 'rocket', 'laser']; // the shader's gun numbers (1..8)

  // the body's volume, roughly (in the body frame), for keeping the flippers out of it: feathers + vest, pouches, backpack, helmet
  const box = (q, b) => {
    const d = [Math.abs(q[0]) - b[0], Math.abs(q[1]) - b[1], Math.abs(q[2]) - b[2]];
    return (
      Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)) + Math.min(Math.max(d[0], d[1], d[2]), 0)
    );
  };
  const bodyD = (p) => {
    const y = p[1],
      rad = y > 0.2 && y < 0.56 ? 0.272 : 0.236;
    let d = (Math.hypot(p[0], y - clamp(y, 0.3, 0.7), p[2] / 0.92) - rad) * 0.92;
    d = Math.min(d, box([Math.abs(p[0]) - 0.24, y - 0.315, p[2] - 0.02], [0.042, 0.064, 0.066]));
    d = Math.min(d, box([p[0], y - 0.47, p[2] + 0.3], [0.2, 0.17, 0.09]));
    d = Math.min(d, Math.max(Math.hypot(p[0] / 0.3, (y - 0.73) / 0.29, p[2] / 0.29) - 1, 0.69 - y) * 0.29);
    d = Math.min(d, box([Math.abs(p[0]) - 0.25, y - 0.665, p[2] - 0.035], [0.045, 0.066, 0.096]));
    return d;
  };
  PG.bodyD = bodyD;
  // two-bone IK with the elbow toward the pole; the pole is swung round the shoulder->hand line until the flipper clears the body
  const POLES = [0];
  for (let k = 1; k <= 20; k++) POLES.push(k * 0.15, -k * 0.15);
  const clearance = (S, E, T, Rb, tb) => {
    let m = 1e9;
    for (let i = 1; i <= 6; i++) {
      const u = i / 6;
      const p = add(S, mul(sub(E, S), u));
      if (len(sub(p, S)) > 0.11) m = Math.min(m, bodyD(mtv(Rb, sub(p, tb))) - 0.045);
    }
    for (let i = 1; i <= 6; i++) {
      const p = add(E, mul(sub(T, E), i / 6));
      m = Math.min(m, bodyD(mtv(Rb, sub(p, tb))) - 0.038);
    }
    return m;
  };
  const arm = (S, T0, pole0, Rb, tb) => {
    let T = T0,
      d = sub(T, S),
      dl = len(d);
    const k = clamp(dl / (L1 + L2), 1, 1.08),
      a1 = L1 * k,
      a2 = L2 * k; // a little stretch, no more
    if (dl > a1 + a2) {
      T = add(S, mul(d, ((a1 + a2) * 0.9999) / dl));
      d = sub(T, S);
      dl = len(d);
    }
    dl = Math.max(dl, 0.02);
    const dir = mul(d, 1 / dl),
      x = (a1 * a1 - a2 * a2 + dl * dl) / (2 * dl),
      h = Math.sqrt(Math.max(0, a1 * a1 - x * x));
    let best = null;
    for (const ang of POLES) {
      let pp = mv(rotAxis(dir, ang), pole0);
      pp = sub(pp, mul(dir, dot(pp, dir)));
      pp = nz(pp);
      const E = add(add(S, mul(dir, x)), mul(pp, h)),
        c = clearance(S, E, T, Rb, tb);
      if (c >= 0) return { E, T, a1, a2, c };
      if (!best || c > best.c) best = { E, T, a1, a2, c };
    }
    return best;
  };
  const segFrame = (from, to, side, fwd) => {
    const y = nz(sub(from, to));
    let x = sub(side, mul(y, dot(side, y)));
    if (len(x) < 0.05) x = cross(y, fwd); // pointing straight out sideways
    x = nz(x);
    return cols(x, y, cross(x, y));
  };

  // o: { aim, vx, vy, dist (screen distance walked, px), t, s (px per unit), hold (0..1), fall (0..1 dead), blink, gun (a DATA.MAIN id
  //      or null), kick (model units the gun recoils), spin (the minigun's barrel angle), pump (0..1 the slide / pump racked);
  //      the lobby also passes yaw (the aim's facing, overriding aim), lift and pitch (the gun raised, the muzzle tipped up) and hop;
  //      elev: the camera's elevation the pose is drawn with, when not the game's (the gun's picture faces it) }
  PG.pose = (o) => {
    const s = o.s,
      aimYaw = o.yaw ?? Math.atan2(cos(o.aim), 2 * sin(o.aim)),
      H = o.gun && o.hold > 0 && !o.fall ? DATA.HOLD[o.gun] : null;
    const yaw = aimYaw + (H ? H.yaw : 0),
      Ry = rotY(yaw);
    const sp = Math.hypot(o.vx, o.vy),
      amt = clamp(sp / 60, 0, 1),
      fast = clamp(sp / 230, 0, 1);
    const gdir = sp > 1 ? nz([o.vx, 0, o.vy * 2]) : mv(Ry, [0, 0, 1]);
    // the step rate follows the distance on screen, so walking up or down the screen looks as brisk as walking sideways; the
    // stride on the ground is longer by as much as the depth foreshortens it (planted feet still never slide)
    const ph = (o.dist / (PG.STEP * s)) * Math.PI,
      t = o.t,
      fz = 1 / (Math.hypot(gdir[0], gdir[2] * sin(ELEV)) || 1);
    // feet: planted ones slide back at exactly the body's ground speed, the swinging one lifts and swings ahead
    const gm = mtv(Ry, gdir); // ground dir in the model
    const feet = [],
      J = {},
      offs = [];
    for (const [k, sx] of [
      [0, 1],
      [1, -1],
    ]) {
      const c = (((ph / TAU + k * 0.5) % 1) + 1) % 1;
      let off,
        lift = 0,
        pitch = 0;
      // swing: a Hermite curve that leaves and lands with the stance's backward speed (the foot never slides), lifting at once
      if (c < DUTY) off = 1 - (2 * c) / DUTY;
      else {
        const e = (c - DUTY) / (1 - DUTY),
          m = (-2 * (1 - DUTY)) / DUTY,
          e2 = e * e,
          e3 = e2 * e;
        off = -(2 * e3 - 3 * e2 + 1) + m * (e3 - 2 * e2 + e) + (-2 * e3 + 3 * e2) + m * (e3 - e2);
        lift = Math.pow(sin(Math.PI * e), 0.7) * 0.05;
        pitch = -0.5 * sin(Math.PI * e);
      }
      offs.push(off);
      const pos = [sx * 0.145 + gm[0] * off * A * fz * amt, lift * amt, gm[2] * off * A * fz * amt];
      const R = mm(Ry, mm(rotY(sx * 0.3), rotX(pitch * amt)));
      feet.push({ R, t: mv(Ry, pos) });
      const w = mv(Ry, pos),
        toe = add(w, mv(R, [0, 0, 0.14])),
        heel = add(w, mv(R, [0, 0, -0.05]));
      const nm = sx > 0 ? 'L' : 'R';
      J['ankle' + nm] = w;
      J['toe' + nm] = toe;
      J['heel' + nm] = heel;
    }
    // body: rocks toward the planted foot, wiggles, rises over it, leans into the run; breathes at rest
    const steady = H ? 0.3 : 1; // a gun in hand: a steadier walk
    const roll = (0.2 - 0.06 * fast) * amt * sin(ph),
      wig = -0.08 * amt * cos(ph) * steady,
      bob = 0.014 * amt * Math.abs(sin(ph)) + 0.004 * sin(t * 2.4) * (1 - amt);
    let Rb = mm(Ry, mm(rotZ(roll), rotY(wig))),
      tb = mv(Ry, [-0.014 * amt * sin(ph), bob, 0]); // the weight shifts over the planted foot
    {
      const h0 = mv(Ry, [0, 0.66, 0.1]),
        h1 = mv(Rb, [0, 0.66, 0.1]); // the rock tips the head toward / away from the camera: keep it level on screen
      tb[1] += ((h1[2] - h0[2]) * sin(ELEV) - (h1[1] - h0[1]) * cos(ELEV)) / cos(ELEV);
    }
    const lean = cross([0, 1, 0], gdir);
    if (len(lean) > 0.01) {
      const L = rotAxis(nz(lean), (0.1 * amt + 0.04 * fast) * steady);
      Rb = mm(L, Rb);
      tb = mv(L, tb);
    }
    if (H && H.lean) {
      const L = rotAxis(mv(Ry, [1, 0, 0]), -H.lean);
      Rb = mm(L, Rb);
      tb = mv(L, tb);
    } // leaning back under a heavy gun
    if (o.hop) {
      tb[1] += o.hop;
      for (const f of feet) f.t[1] += o.hop;
    }
    if (o.fall) {
      const back = mv(Ry, [0, 0, -1]),
        ax = nz(cross([0, 1, 0], back)),
        F = rotAxis(ax, 1.5 * o.fall),
        piv = mul(back, 0.12); // topples onto its back
      Rb = mm(F, Rb);
      tb = add(piv, mv(F, sub(tb, piv)));
      for (const f of feet) {
        f.R = mm(F, f.R);
        f.t = add(piv, mv(F, sub(f.t, piv)));
      }
    }
    // the gun: held rigidly in the body's frame turned back to the aim (it rocks, hops and leans with the penguin, so the flippers'
    // grips never slide), recoiling along its barrel
    let G = null;
    if (H) {
      const Ra = mm(Rb, rotY(-H.yaw)),
        Rg = mm(Ra, rotX(-(o.pitch || 0)));
      const tg = add(add(mv(Ra, add(H.O, [0, o.lift || 0, 0])), tb), mv(Rg, [0, 0, -(o.kick || 0)]));
      const K = H.k || [1, 1, 1];
      G = { Rg, tg, H, at: (q) => add(tg, mv(Rg, [q[0] * K[0], q[1] * K[1], q[2] * K[2]])) };
    }
    // flippers: hands on the gun's grips (IK, elbows out and clear of the body); a free flipper hangs and swings against its leg
    // (beside a one-handed gun it rests closer in, the shoulder left where it is)
    const fl = [];
    for (const [k, sx] of [
      [0, 1],
      [1, -1],
    ]) {
      const hp = G && (sx > 0 ? G.H.Lh : G.H.R),
        one = G && !hp;
      const pro = H && !one ? Math.PI / 2 - (Math.PI / 2 - H.pro) * clamp(o.hold, 0, 1) : Math.PI / 2; // shoulders come round to hold
      const S = add(mv(Rb, [sx * SH[0] * sin(pro), SH[1], SH[0] * cos(pro)]), tb),
        side = mv(Rb, [sx, 0, 0]);
      let T;
      if (hp)
        T = G.at(
          hp[2] !== undefined ? [hp[0], hp[1], hp[2] - (sx > 0 && G.H.pump ? (o.pump || 0) * G.H.pump : 0)] : hp,
        );
      else if (o.fall) T = add(S, mv(Rb, [sx * (0.3 + 0.05 * sin(t * 9 + sx) * o.fall), -0.12, 0.06]));
      else {
        const sw = -offs[k] * A * 0.55 * amt; // swings against its own leg
        T = add(
          add(S, mv(Rb, one ? [sx * 0.165, -0.315, 0.03] : [sx * 0.19, -0.3, 0.04])),
          add(mul(mv(Ry, gm), sw), [0, 0.005 * sin(t * 3 + sx), 0]),
        );
      }
      const pl = (hp && G.H.pole) || [0.85, -0.45, -0.3]; // where the elbow points (x outward)
      const r = arm(S, T, nz(mv(Rb, [sx * pl[0], pl[1], pl[2]])), Rb, tb);
      const fwd = mv(Rb, [0, 0, sx]);
      fl.push({
        up: segFrame(S, r.E, side, fwd),
        lo: segFrame(r.E, r.T, side, fwd),
        S,
        E: r.E,
        T: r.T,
        want: hp ? T : null,
        a1: r.a1,
        a2: r.a2,
        c: r.c,
      });
      const nm = sx > 0 ? 'L' : 'R';
      J['sh' + nm] = S;
      J['elbow' + nm] = r.E;
      J['hand' + nm] = r.T;
    }
    J.hipL = add(mv(Rb, [0.11, 0.1, 0]), tb);
    J.hipR = add(mv(Rb, [-0.11, 0.1, 0]), tb);
    J.hip = add(mv(Rb, [0, 0.12, 0]), tb);
    J.head = add(mv(Rb, [0, 0.66, 0.1]), tb);
    J.top = add(mv(Rb, [0, 1.0, 0]), tb);
    J.ground = [0, 0, 0];
    const K = G ? DATA.gunK(o.gun) : [1, 1, 1],
      gi = G ? PG.GUNS.indexOf(o.gun) + 1 : 0,
      gb = G ? G.H.b : [0, 0, 0, 0],
      gbs = [gb[0] * K[2], gb[1] * K[2], gb[2] * K[0], gb[3] * K[1]];
    let bound2 = [0, 0, 0, 0];
    if (G) {
      const c = G.at([0, gb[3], (gb[0] + gb[1]) / 2]),
        r = (gbs[1] - gbs[0]) / 2 + gbs[2] + 0.03;
      bound2 = [...c, r * r];
      J.grip = G.tg;
      J.tip = G.at(G.H.mz);
    }
    // the gun's mesh (gunmesh.js) when it has one: drawn with the penguin in a layer (PG.draw); the penguin's own model of it is off
    const ME =
      G && G.H.mesh && window.GUNMESH && GUNMESH.has(o.gun)
        ? {
            id: o.gun,
            Rg: flat(G.Rg),
            tg: G.tg,
            K: [1, 1, 1],
            spinP: DATA.GUN3D[o.gun].anchors.spin || [0, 0, 0],
            spin: o.spin || 0,
            slide: (o.pump || 0) * (G.H.pump || 0),
          }
        : null;
    return {
      yaw,
      near: 1,
      J,
      fall: o.fall || 0,
      G,
      fl,
      gi,
      muzzle: G ? G.at(G.H.mz) : null,
      port: G && G.H.port ? G.at(G.H.port) : null,
      mesh: ME,
      U: {
        u_bound: o.fall ? [0, 0.25, 0, 1.3] : [0, 0.45, 0, 0.62],
        u_bound2: bound2,
        u_Rb: flat(Rb),
        u_tb: tb,
        u_Rul: flat(fl[0].up),
        u_tul: fl[0].S,
        u_Rll: flat(fl[0].lo),
        u_tll: fl[0].E,
        u_Rur: flat(fl[1].up),
        u_tur: fl[1].S,
        u_Rlr: flat(fl[1].lo),
        u_tlr: fl[1].E,
        u_seg: [fl[0].a1, fl[0].a2, fl[1].a1, fl[1].a2],
        u_Rkl: flat(feet[0].R),
        u_tkl: feet[0].t,
        u_Rkr: flat(feet[1].R),
        u_tkr: feet[1].t,
        u_Rg: G ? flat(G.Rg) : flat(rotY(0)),
        u_tg: G ? G.tg : [0, 0, 0],
        u_gun: ME ? 0 : gi,
        u_gb: gbs,
        u_gk: K,
        u_spin: o.spin || 0,
        u_pump: o.pump || 0,
        u_blink: o.blink ?? 1,
        u_t: o.t || 0,
      },
    };
  };
  // draw: one quad covering the body's bounding sphere and the gun's, as the ortho camera sees them (pass is unused, kept for callers)
  // The shader in variants, one compiled program each (cached by G.program): the penguin holding gun gi (1-8), or nothing (0); a
  // menu draws a gun alone with its variant (u_only). Each compiles in the background (PG.warm, G.prepare) and is drawn once it is
  // ready: until then the penguin holds nothing and a menu shows the gun's icon. PG.sync (tests, QA renders) compiles on the spot.
  PG.sync = false;
  PG.prog = (gi) => (PG.sync ? G.program : G.prepare)('peng' + (gi | 0), '#define GUN ' + (gi | 0) + '\n' + PG.FS);
  PG.progL = () => (PG.sync ? G.program : G.prepare)('pengL', '#define LAYER\n#define GUN 0\n' + PG.FS); // with a mesh gun
  // ready: the variants a run with gun gi draws (its own, and pengL when the gun has a mesh); warm: compiled in the background (a shader
  // that fails rejects: the boot shows why instead of waiting for ever)
  PG.ready = (gi) => !!PG.prog(gi) && (!gi || !DATA.GUN3D[PG.GUNS[gi - 1]] || !!PG.progL());
  PG.warm = (list) =>
    new Promise((res, rej) => {
      const tick = () => {
        try {
          if (list.every((gi) => PG.ready(gi))) res();
          else setTimeout(tick, 40);
        } catch (e) {
          rej(e);
        }
      };
      tick();
    });
  // prog: a program to draw with (a tool's debug variant), or nothing: the variant for the pose's gun (the gunless one while that compiles)
  const safe = (f) => {
    try {
      return f();
    } catch (e) {
      return null;
    }
  }; // a variant that failed to compile: drawn without, the frame goes on
  PG.draw = (prog, x, y, s, pose, pass, extra = {}) => {
    const U = Object.assign(
      {
        u_anchor: [x, y],
        u_s: s,
        u_px: 1 / (s * (extra.dens || 1)),
        u_elev: ELEV,
        u_flash: 0,
        u_alpha: 1,
        u_lk: 0.45,
        u_lit: 0,
        u_bg: [0, 0, 0, 0],
        u_only: 0,
      },
      pose.U,
      extra.U,
    );
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    for (const B of [U.u_bound, U.u_bound2]) {
      if (!(B[3] > 0)) continue;
      const c = PG.project(B, s, U.u_elev),
        r = Math.sqrt(B[3]) * s + 3;
      x0 = Math.min(x0, c[0] - r);
      y0 = Math.min(y0, c[1] - r);
      x1 = Math.max(x1, c[0] + r);
      y1 = Math.max(y1, c[1] + r);
    }
    if (x0 > x1) return;
    // a gun with a mesh: the gun, then the penguin (its LAYER variant, writing depth) into gunmesh.js's layer, laid over the target
    const ME = !prog && pose.mesh,
      prL = ME && safe(PG.progL);
    if (prL) {
      const X0 = x + x0,
        Y0 = y + y0,
        ctx = GUNMESH.begin(X0, Y0, x1 - x0, y1 - y0);
      GUNMESH.draw(ctx, ME, x, y, s, U);
      G.blend();
      G.draw(
        prL,
        Object.assign({}, U, { u_anchor: [x - X0, y - Y0], u_alpha: 1, u_org: [X0, Y0], u_vres: ctx.vres }),
        G.xf(0, 0, x1 - x0, y1 - y0),
      );
      GUNMESH.end(ctx, U.u_alpha);
      return;
    }
    let pr = prog;
    if (!pr) {
      if (ME) U.u_gun = pose.gi;
      pr = safe(() => PG.prog(U.u_gun));
      if (!pr && U.u_gun) {
        pr = safe(() => PG.prog(0));
        U.u_gun = 0;
      }
    }
    if (!pr) return;
    G.blend();
    G.draw(pr, U, G.xf(x + x0, y + y0, x1 - x0, y1 - y0));
  };
  // model-space joints -> screen points for qa.mjs (animation.md §14)
  PG.trace = (pose, x, y, s) => {
    const out = {};
    for (const k in pose.J) {
      const p = PG.project(pose.J[k], s);
      out[k] = [x + p[0], y + p[1]];
    }
    return out;
  };
  // a gun alone (menus): its centre on (x, y), s px per model unit, turned yaw about the vertical, seen from e above; the uniforms to
  // draw it with, the radius (px) of the quad it needs, and its drawn length (model units)
  PG.gunLen = (id) => {
    const H = DATA.HOLD[id],
      K = DATA.gunK(id);
    return (H.b[1] - H.b[0]) * K[2];
  };
  PG.gunU = (id, x, y, s, yaw, e, tilt = 0.12) => {
    const H = DATA.HOLD[id],
      K = DATA.gunK(id),
      b = [H.b[0] * K[2], H.b[1] * K[2], H.b[2] * K[0], H.b[3] * K[1]],
      r = (b[1] - b[0]) / 2 + b[2];
    const Rg = mm(rotY(yaw), rotX(tilt)),
      tg = mul(mv(Rg, [0, b[3], (b[0] + b[1]) / 2]), -1); // the gun's centre on the origin
    return {
      R: r * s + 3,
      U: {
        u_anchor: [x, y],
        u_s: s,
        u_px: 1 / s,
        u_elev: e,
        u_flash: 0,
        u_alpha: 1,
        u_lk: 0,
        u_lit: 0,
        u_only: 1,
        u_blink: 1,
        u_bg: [0, 0, 0, 0],
        u_bound: [0, 0, 0, 0],
        u_bound2: [0, 0, 0, r * r],
        u_Rg: flat(Rg),
        u_tg: tg,
        u_gun: PG.GUNS.indexOf(id) + 1,
        u_gb: b,
        u_gk: K,
        u_spin: 0.3,
        u_pump: 0,
      },
    };
  };
  PG.drawGun = (prog, id, x, y, s, yaw, e, tilt, extra = {}) => {
    const g = PG.gunU(id, x, y, s, yaw, e, tilt);
    if (DATA.HOLD[id].mesh && window.GUNMESH && GUNMESH.has(id)) {
      const ctx = GUNMESH.begin(x - g.R, y - g.R, g.R * 2, g.R * 2); // its mesh
      GUNMESH.draw(
        ctx,
        { id, Rg: g.U.u_Rg, tg: g.U.u_tg, spinP: DATA.GUN3D[id].anchors.spin, spin: extra.u_spin || 0, slide: 0 },
        x,
        y,
        s,
        { u_elev: e, u_shade: 0.6 },
      );
      GUNMESH.end(ctx, 1);
      return true;
    }
    const pr = PG.prog(g.U.u_gun);
    if (!pr) return false; // false: not compiled yet
    G.blend();
    G.draw(pr, Object.assign(g.U, extra), G.xf(x - g.R, y - g.R, g.R * 2, g.R * 2));
    return true;
  };
  // the guns alone, as menu icons: each rendered side-on (a touch from the front and above) over black and over white, the two
  // readings giving the true colour and coverage; returns { i_<id>: data URL }, cropped to the gun
  PG.icons = (prog, W = 420, Hh = 240) => {
    const out = {},
      cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Hh;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    const shot = (U, bg) => {
      G.bind(null, [bg, bg, bg, 1]);
      G.blend();
      G.draw(
        G.program('peng' + U.u_gun, '#define GUN ' + U.u_gun + '\n' + PG.FS),
        Object.assign({}, U, { u_bg: [bg, bg, bg, 1] }),
        G.xf(0, 0, W, Hh),
      );
      c2.clearRect(0, 0, W, Hh);
      c2.drawImage(G.canvas, 0, 0, W, Hh, 0, 0, W, Hh);
      return c2.getImageData(0, 0, W, Hh);
    };
    for (const id of PG.GUNS) {
      const H = DATA.HOLD[id],
        K = DATA.gunK(id),
        s = Math.min((W * 0.86) / PG.gunLen(id), (Hh * 0.8) / (2 * H.b[2] * K[0] + 0.06));
      const U = PG.gunU(id, W / 2, Hh / 2, s, Math.PI / 2 - 0.5, 0.32).U;
      const k = shot(U, 0),
        w = shot(U, 1),
        img = c2.createImageData(W, Hh);
      for (let i = 0; i < k.data.length; i += 4) {
        const a = 1 - (w.data[i] - k.data[i] + (w.data[i + 1] - k.data[i + 1]) + (w.data[i + 2] - k.data[i + 2])) / 765;
        img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
        for (let j = 0; j < 3; j++) img.data[i + j] = a > 0.004 ? Math.min(255, Math.round(k.data[i + j] / a)) : 0;
      }
      let x0 = W,
        y0 = Hh,
        x1 = -1,
        y1 = -1; // cropped to the gun, a little margin
      for (let y = 0; y < Hh; y++)
        for (let x = 0; x < W; x++)
          if (img.data[(y * W + x) * 4 + 3] > 8) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
      const m = 4;
      x0 = Math.max(0, x0 - m);
      y0 = Math.max(0, y0 - m);
      x1 = Math.min(W - 1, x1 + m);
      y1 = Math.min(Hh - 1, y1 + m);
      const cc = document.createElement('canvas');
      cc.width = x1 - x0 + 1;
      cc.height = y1 - y0 + 1;
      c2.putImageData(img, 0, 0);
      cc.getContext('2d').drawImage(cv, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height);
      out['i_' + id] = cc.toDataURL('image/png');
    }
    return out;
  };
})();
