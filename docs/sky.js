/* JOSIE's living sky for the web: a 1:1 port of the app's Metal sky
   (JosieUI/Metal/Shaders.swift `sky_fragment`) and its time-of-day model
   (JosieCore/Visual/SkyTime.swift, SkyColors, SkyEffects.starSeed).
   Usage: const sky = JosieSky.create(canvas); sky.setHour(21.5); sky.setGlow('#ff8aa0', 1);
   Returns null when WebGL is unavailable, so the caller keeps its CSS gradient. */
(function () {
  'use strict';

  // ---- tuning that differs from the app (everything else is the app's value) ----
  var SHOOTING_STAR_PERIOD = 14;   // seconds; the app uses 47 (about one every two minutes)
  var RENDER_SCALE = 0.5;          // canvas pixels per CSS pixel; the clouds are soft
  var MAX_FPS = 30;                // the app renders its sky at 30 fps
  var HOUR_RATE = 4;               // 1/s eased approach of the scrolled hour
  var STAR_SEED = 17.31;           // SkyEffects.starSeed
  var LOCATION = { lat: 48.8, lon: 9.2 };     // SkyTime.defaultLocation (Stuttgart)
  var DAY_UTC = Date.UTC(2026, 5, 21);        // midsummer, so the scroll passes a high midday sun
  var UTC_OFFSET = 2;                         // CEST

  // ---- time of day (SkyTime.swift) ----
  var rad = Math.PI / 180;
  function mod(a, n) { return ((a % n) + n) % n; }

  function sunPosition(ms) {
    var n = ms / 86400000 + 2440587.5 - 2451545.0;
    var L = mod(280.46 + 0.9856474 * n, 360);
    var g = mod(357.528 + 0.9856003 * n, 360) * rad;
    var lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    var eps = (23.439 - 0.0000004 * n) * rad;
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var gmst = mod(18.697374558 + 24.06570982441908 * n, 24) * 15;
    var hourAngle = mod(gmst + LOCATION.lon - ra + 180, 360) - 180;
    var phi = LOCATION.lat * rad;
    var sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle * rad);
    return { elevation: Math.asin(Math.max(-1, Math.min(1, sinEl))) / rad, hourAngle: hourAngle };
  }

  function toLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function toLab(c) {
    var r = toLinear(c[0]), g = toLinear(c[1]), b = toLinear(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromLab(c) {
    var l = Math.pow(c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2], 3);
    var m = Math.pow(c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2], 3);
    var s = Math.pow(c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2], 3);
    function k(v) { return Math.min(1, Math.max(0, toSrgb(v))); }
    return [k(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      k(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      k(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function mixLab(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    var la = toLab(a), lb = toLab(b);
    return fromLab([0, 1, 2].map(function (i) { return la[i] + (lb[i] - la[i]) * t; }));
  }
  function mixLin(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }
  function mixPalette(a, b, t) {
    return { zenith: mixLab(a.zenith, b.zenith, t), mid: mixLab(a.mid, b.mid, t), horizon: mixLab(a.horizon, b.horizon, t),
      haze: mixLab(a.haze, b.haze, t), sun: mixLab(a.sun, b.sun, t), sunAmount: a.sunAmount + (b.sunAmount - a.sunAmount) * t,
      grade: mixLin(a.grade, b.grade, t) };
  }
  function hex(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function key(el, z, m, h, hz, s, amt, grade) {
    return { el: el, p: { zenith: hex(z), mid: hex(m), horizon: hex(h), haze: hex(hz), sun: hex(s), sunAmount: amt, grade: grade || [1, 1, 1] } };
  }
  // SkyColors (OrbVisuals.swift): the hand-tuned daytime sky.
  var DAY = { zenith: [0.13, 0.3, 0.58], mid: [0.3, 0.55, 0.84], horizon: [0.68, 0.79, 0.9], haze: [0.86, 0.84, 0.82], sun: [1, 0.97, 0.9], sunAmount: 0, grade: [1, 1, 1] };
  var CLOUD = { lit: [0.97, 0.98, 1.0], shade: [0.58, 0.63, 0.7], ground: [0.56, 0.56, 0.57] };
  var NIGHT = [
    key(-90, '#03050f', '#060b1d', '#0e1630', '#121729', '#000000', 0, [0.4, 0.44, 0.58]),
    key(-18, '#050a1c', '#0a1430', '#172447', '#1b2340', '#000000', 0, [0.42, 0.46, 0.6]),
    key(-12, '#08112e', '#122149', '#28365f', '#2b2f4c', '#3a3460', 0.06, [0.5, 0.54, 0.68])
  ];
  var HIGH = [
    key(20, '#1f4783', '#4a83c6', '#b3cbe2', '#dcd8d1', '#fff6e6', 0.1),
    { el: 35, p: DAY },
    key(55, '#1a4290', '#4688d6', '#a9c7e7', '#d8d6d2', '#ffffff', 0),
    key(90, '#173d8a', '#4285d4', '#a6c5e6', '#d6d5d2', '#ffffff', 0)
  ];
  var MORNING = NIGHT.concat([
    key(-6, '#132a5c', '#2d4886', '#7b7ea9', '#9a8aa2', '#e49a8e', 0.25, [0.66, 0.68, 0.8]),
    key(-2, '#22407a', '#5576ab', '#e7a68f', '#efb59d', '#ffae7c', 0.55, [0.82, 0.8, 0.86]),
    key(0, '#375c95', '#7b9cc8', '#ffbf8c', '#ffcfa0', '#ffa862', 0.8, [0.93, 0.89, 0.89]),
    key(4, '#2f5a9a', '#78a2d3', '#f5d3b2', '#f8dcc2', '#ffd29c', 0.55, [0.98, 0.96, 0.95]),
    key(10, '#244a86', '#5d8bc7', '#c8d8e7', '#e6ddd2', '#fff0d8', 0.25)
  ], HIGH);
  var EVENING = NIGHT.concat([
    key(-6, '#111d50', '#2b3376', '#694a86', '#5d4a7a', '#b04c5c', 0.2, [0.62, 0.6, 0.76]),
    key(-2, '#29336e', '#685998', '#e0625a', '#c86b78', '#ff5c3c', 0.6, [0.8, 0.72, 0.78]),
    key(0, '#32437d', '#877ead', '#ff8b4e', '#ff9b5c', '#ff7a3a', 0.9, [0.93, 0.83, 0.79]),
    key(4, '#2a4c86', '#6e8fbf', '#f5c68c', '#ffcf8c', '#ffb85e', 0.65, [0.98, 0.94, 0.88]),
    key(10, '#22467f', '#5a86bd', '#d6d4c6', '#f0d6b2', '#ffd892', 0.32)
  ], HIGH);
  function sample(keys, el) {
    if (el <= keys[0].el) return keys[0].p;
    for (var i = 1; i < keys.length; i++) {
      if (el <= keys[i].el) return mixPalette(keys[i - 1].p, keys[i].p, (el - keys[i - 1].el) / (keys[i].el - keys[i - 1].el));
    }
    return keys[keys.length - 1].p;
  }
  function eveningWeight(ha) { var t = Math.min(1, Math.max(0, (Math.sin(ha * rad) + 0.6) / 1.2)); return t * t * (3 - 2 * t); }
  function darkness(el) { var t = Math.min(1, Math.max(0, (-3 - el) / (-3 + 11))); return t * t * (3 - 2 * t); }

  // Sky state at a local hour of the reference day (may run past 24 into the night).
  function stateAt(hour) {
    var sun = sunPosition(DAY_UTC + (hour - UTC_OFFSET) * 3600000);
    var w = eveningWeight(sun.hourAngle);
    var palette = w <= 0 ? sample(MORNING, sun.elevation) : w >= 1 ? sample(EVENING, sun.elevation)
      : mixPalette(sample(MORNING, sun.elevation), sample(EVENING, sun.elevation), w);
    var x = 0.5 + 0.38 * Math.sin(sun.hourAngle * rad), y = 0.1 + (sun.elevation / 60) * 0.8;
    return { palette: palette, sunPos: [Math.min(0.92, Math.max(0.08, x)), Math.min(1.1, Math.max(-0.35, y))], darkness: darkness(sun.elevation) };
  }

  // ---- shader (Shaders.swift sky_fragment, GLSL ES 1.0; gl_FragCoord is already bottom-left) ----
  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';
  function frag(lite) {
    return [
      'precision highp float;',
      '#define OCT_A ' + (lite ? 3 : 4), '#define OCT_B ' + (lite ? 4 : 5),
      'uniform vec2 res,focus,sunPos;uniform float time,tintAmt,sunAmt,shootPeriod;',
      'uniform vec3 tint,zenith,midc,horizon,haze,cloudLit,cloudShade,groundCloud,sunc,grade;uniform vec4 effects,fx;',
      'float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}',
      'float vnoise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);',
      ' return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),',
      '  mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);}',
      'const mat3 OCT_ROT=mat3(vec3(0.00,0.80,0.60),vec3(-0.80,0.36,-0.48),vec3(-0.60,-0.48,0.64));',
      'float fbm4(vec3 p){float s=0.0,a=0.5,n=0.0;for(int i=0;i<OCT_A;i++){s+=a*vnoise(p);n+=a;p=OCT_ROT*p*2.03;a*=0.5;}return s/n;}',
      'float fbm5(vec3 p){float s=0.0,a=0.5,n=0.0;for(int i=0;i<OCT_B;i++){s+=a*vnoise(p);n+=a;p=OCT_ROT*p*2.03;a*=0.5;}return s/n;}',
      'vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.x,p.y,p.x)*vec3(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}',
      'float starCells(vec2 q,float cell,float density,float seed,float t,float twinkle,float minSize){',
      ' vec2 id=floor(q/cell);float h=hash13(vec3(id,seed));if(h>density)return 0.0;',
      ' vec2 r=hash22(id+seed);vec2 c=(id+0.2+0.6*r)*cell;float d=length(q-c);float hb=h/density;float big=step(0.9,hb);',
      ' float size=max(minSize,mix(mix(0.32,0.60,r.x),mix(0.75,0.95,r.y),big));float core=exp(-(d*d)/(size*size));',
      ' float hs=size*2.0;float halo=big*exp(-(d*d)/(hs*hs))*0.06;',
      ' float a=mix(mix(0.25,0.50,r.y),mix(0.50,0.60,r.x),big);float amp=mix(0.10,0.18,big);float speed=mix(0.25,0.85,r.x);',
      ' float tw=1.0-twinkle*amp*(0.5+0.5*sin(t*speed+6.2831*r.y));return (core+halo)*a*tw;}',
      'float shootingStar(vec2 p,float aspect,float t,float seed,float width){',
      ' float period=shootPeriod;float k=floor(t/period);float h=hash13(vec3(k,seed,7.1));if(h>0.4)return 0.0;',
      ' float t0=(0.1+0.7*fract(h*13.7))*period;float s=(t-k*period-t0)/0.9;if(s<0.0||s>1.0)return 0.0;',
      ' vec2 r=hash22(vec2(k,seed));vec2 start=vec2((r.x-0.5)*0.7*aspect,0.68+0.25*r.y);',
      ' vec2 dir=normalize(vec2(r.x>0.5?-0.85:0.85,-0.42));vec2 head=start+dir*(s*0.42);vec2 tail=head-dir*0.2*min(1.0,s*3.0);',
      ' vec2 pa=p-tail,ba=head-tail;float along=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);float d=length(pa-ba*along);',
      ' return exp(-(d*d)/(width*width))*along*along*sin(3.14159*s)*0.8;}',
      'float clouds(vec2 p,float t,float scale,vec2 wind,float cover,float soft,float evolve){',
      ' vec3 q=vec3(p*scale+wind*t,t*evolve);vec2 w=vec2(fbm4(q+vec3(0.0,0.0,t*0.013)),fbm4(q+vec3(5.2,1.3,t*0.011)));',
      ' float d=fbm5(q+vec3(w*1.7,0.0));return smoothstep(cover,cover+soft,d);}',
      'void main(){',
      ' vec2 fragCoord=gl_FragCoord.xy;vec2 uv=fragCoord/res;float aspect=res.x/res.y;vec2 p=vec2((uv.x-0.5)*aspect,uv.y);float t=time;',
      ' vec3 col=mix(horizon,midc,smoothstep(0.0,0.6,uv.y));col=mix(col,zenith,smoothstep(0.55,1.05,uv.y+uv.x*0.08));',
      ' vec2 hz=(uv-vec2(0.72,0.18))*vec2(1.1,1.9);float hazeA=exp(-dot(hz,hz)*2.2);col=mix(col,haze,hazeA*0.35);',
      ' vec2 sp=(uv-sunPos)*vec2(aspect,1.0);float sunHalo=exp(-dot(sp,sp)*5.0);',
      ' float band=exp(-max(uv.y,0.0)*3.2)*(0.45+0.55*exp(-abs(sp.x)*1.4));',
      ' col=mix(col,sunc,clamp((sunHalo*0.75+band*0.55)*sunAmt,0.0,1.0));',
      ' vec2 fd=(uv-focus)*vec2(aspect,1.0);float glow=exp(-dot(fd,fd)*3.5);col+=vec3(0.20,0.22,0.24)*glow*0.55;',
      ' mat2 rot=mat2(vec2(0.94,0.34),vec2(-0.34,0.94));vec2 ps=rot*p;',
      ' float hi=clouds(ps*vec2(0.55,2.4),t,1.6,vec2(0.020,0.004),0.50,0.38,0.010);',
      ' col=mix(col,cloudLit,hi*0.42*smoothstep(0.1,0.9,uv.y+0.2));',
      ' vec2 lightDir=normalize(vec2(0.55,0.8))*0.045;',
      ' float m0=clouds(p,t,1.35,vec2(0.012,0.002),0.46,0.42,0.016);float m1=clouds(p+lightDir,t,1.35,vec2(0.012,0.002),0.46,0.42,0.016);',
      ' float shade=clamp((m1-m0)*2.4+0.35*m0,0.0,1.0);vec3 midCloud=mix(cloudLit,cloudShade,shade*0.75);',
      ' midCloud+=vec3(1.0,0.97,0.93)*(1.0-smoothstep(0.0,0.25,m0))*m0*0.6;col=mix(col,midCloud,m0*0.62);',
      ' float corner=(1.0-smoothstep(0.0,0.75,uv.y))*(0.45+0.55*smoothstep(0.15,0.75,abs(uv.x-0.5)*2.0));',
      ' float lo=clouds(p+vec2(3.7,1.9),t,0.85,vec2(0.006,0.0),0.38,0.5,0.02);',
      ' float loShade=clouds(p+vec2(3.7,1.9)+lightDir*2.0,t,0.85,vec2(0.006,0.0),0.38,0.5,0.02);',
      ' vec3 lowCloud=mix(vec3(0.92,0.91,0.89),groundCloud,clamp((loShade-lo)*2.0+0.45,0.0,1.0));col=mix(col,lowCloud,lo*corner*0.85);',
      ' float sd=uv.y-0.2-(uv.x-0.45)*0.75;float streakN=fbm4(vec3(p*vec2(1.4,3.0)+vec2(t*0.01,0.0),t*0.02));',
      ' float streak=exp(-sd*sd*26.0)*smoothstep(0.25,0.75,uv.x)*(0.55+0.6*streakN);col=mix(col,cloudLit,clamp(streak,0.0,1.0)*0.38);',
      ' col*=grade;',
      ' if(effects.x>0.001){',
      '  float su=max(res.x/1600.0,res.y/1000.0);float stars=starCells(fragCoord/su,48.0,0.12,fx.w,fx.x,fx.y,0.7/su);',
      '  float clear=(1.0-clamp(m0*1.4,0.0,1.0))*(1.0-hi*0.7)*(1.0-lo*corner*0.9);',
      '  float vis=smoothstep(0.12,0.45,uv.y)*mix(0.6,1.0,uv.y)*clear*effects.x;',
      '  float shoot=(fx.y>0.5&&effects.x>0.6)?shootingStar(p,aspect,fx.x,fx.w,max(0.0012,1.2/res.y)):0.0;',
      '  col+=vec3(0.902,0.925,1.0)*(stars*vis+shoot*clear*effects.x);}',
      ' col=mix(col,col*(0.75+0.5*tint),glow*tintAmt*0.35);col*=mix(0.86,1.0,smoothstep(0.0,0.38,uv.y));',
      ' vec2 vd=uv-0.5;col*=1.0-dot(vd,vd)*0.28;col+=(hash13(vec3(fragCoord,t))-0.5)/255.0;',
      ' gl_FragColor=vec4(col,1.0);}'
    ].join('\n');
  }

  function create(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) return null;
    var lite = Math.min(screen.width, screen.height) < 820;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag(lite)));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { console.warn('JosieSky:', e); return null; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['res', 'focus', 'sunPos', 'time', 'tintAmt', 'sunAmt', 'shootPeriod', 'tint', 'zenith', 'midc', 'horizon', 'haze',
      'cloudLit', 'cloudShade', 'groundCloud', 'sunc', 'grade', 'effects', 'fx'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hour = opts.hour != null ? opts.hour : 9, target = hour;
    var glow = hex(opts.glow || '#ffd2c2'), glowTarget = glow, glowAmt = opts.glowAmount != null ? opts.glowAmount : 0.3, glowAmtTarget = glowAmt;
    var focus = opts.focus || [0.5, 0.55];
    var skyTime = 0, fxClock = 0, last = 0, lastDraw = 0, raf = 0, dead = false, wasDark = false;

    function size() {
      var w = Math.max(1, Math.round(canvas.clientWidth * RENDER_SCALE)), h = Math.max(1, Math.round(canvas.clientHeight * RENDER_SCALE));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    }
    function frame(ts) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = ts; return; }
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      skyTime += dt * (reduce ? 0.25 : 1);
      fxClock = (fxClock + dt) % 86400;
      var e = 1 - Math.exp(-HOUR_RATE * dt);
      hour += (target - hour) * e;
      glow = mixLin(glow, glowTarget, 1 - Math.exp(-3 * dt));
      glowAmt += (glowAmtTarget - glowAmt) * (1 - Math.exp(-3 * dt));
      if (ts - lastDraw < 1000 / MAX_FPS - 2) return;
      lastDraw = ts;
      size();
      var s = stateAt(hour), p = s.palette;
      if (s.darkness > 0.6 && !wasDark && !reduce) fxClock = nextShootingStar(fxClock + 1.5) - 1.5;
      wasDark = s.darkness > 0.6;
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform2f(U.focus, focus[0], focus[1]);
      gl.uniform2f(U.sunPos, s.sunPos[0], s.sunPos[1]);
      gl.uniform1f(U.time, skyTime);
      gl.uniform1f(U.tintAmt, glowAmt);
      gl.uniform1f(U.sunAmt, p.sunAmount);
      gl.uniform1f(U.shootPeriod, SHOOTING_STAR_PERIOD);
      gl.uniform3fv(U.tint, glow);
      gl.uniform3fv(U.zenith, p.zenith);
      gl.uniform3fv(U.midc, p.mid);
      gl.uniform3fv(U.horizon, p.horizon);
      gl.uniform3fv(U.haze, p.haze);
      gl.uniform3fv(U.cloudLit, CLOUD.lit);
      gl.uniform3fv(U.cloudShade, CLOUD.shade);
      gl.uniform3fv(U.groundCloud, CLOUD.ground);
      gl.uniform3fv(U.sunc, p.sun);
      gl.uniform3fv(U.grade, p.grade);
      gl.uniform4f(U.effects, s.darkness, 0, 0, 0);
      gl.uniform4f(U.fx, fxClock, reduce ? 0 : 1, 0, STAR_SEED);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    raf = requestAnimationFrame(frame);
    return {
      setHour: function (h, now) { target = h; if (now) hour = h; },
      setGlow: function (color, amount) { glowTarget = hex(color); glowAmtTarget = amount; },
      destroy: function () { dead = true; cancelAnimationFrame(raf); var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    };
  }

  // The shader's own schedule (shootingStar in the GLSL), evaluated here so the first night frame
  // can start the clock just before a shooting star instead of making the visitor wait for one.
  function fract(x) { return x - Math.floor(x); }
  function hash13(a, b, c) {
    var p = [fract(a * 0.1031), fract(b * 0.1031), fract(c * 0.1031)];
    var d = p[0] * (p[2] + 31.32) + p[1] * (p[1] + 31.32) + p[2] * (p[0] + 31.32);
    return fract((p[0] + d + p[1] + d) * (p[2] + d));
  }
  function nextShootingStar(after) {
    for (var k = Math.floor(after / SHOOTING_STAR_PERIOD); k < 1000; k++) {
      var h = hash13(k, STAR_SEED, 7.1);
      var t = k * SHOOTING_STAR_PERIOD + (0.1 + 0.7 * fract(h * 13.7)) * SHOOTING_STAR_PERIOD;
      if (h <= 0.4 && t > after) return t;
    }
    return after;
  }

  function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')'; }
  window.JosieSky = { create: create, stateAt: stateAt, css: css };
})();
