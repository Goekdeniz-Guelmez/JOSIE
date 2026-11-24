/* JOSIE's liquid orb for the web: a 1:1 port of the app's Metal orb
   (JosieUI/Metal/Shaders.swift `orb_fragment`), its palettes (JosieCore OrbVisuals)
   and its clock (OrbClock). Usage: const orb = JosieOrb.create(canvas); orb.setState('speaking');
   Returns null without WebGL, so the caller keeps its <img> fallback. */
(function () {
  'use strict';

  var RADIUS = 1 / 1.7;        // OrbLayout.radius: the rest of the canvas is halo
  var BLEND_K = 0.08;          // OrbPaletteBlender.step k, per 60 fps frame
  var MAX_SCALE = 2;           // device-pixel cap for the orb canvas

  // OrbVisuals palettes: core, mid, highlight, glow, speed, swirl, turbulence, reactivity.
  var PALETTES = {
    idle: ['#f59a82', '#f9c8b6', '#fff6f1', '#ffd2c2', 0.45, 0, 0.5, 0],
    listening: ['#ff6440', '#ff9370', '#fff3ec', '#ff8a66', 0.8, 0, 0.8, 0.6],
    userSpeaking: ['#ff5530', '#ff8a52', '#fff4e2', '#ff9a62', 1.2, 0.1, 1.1, 1],
    thinking: ['#7d6cf2', '#b8a8ff', '#f4f1ff', '#ad9cff', 0.6, 0.35, 0.9, 0.1],
    speaking: ['#ff4d6a', '#ff97a8', '#fff0f2', '#ff8aa0', 1.1, 0.05, 1, 1],
    tool: ['#13a99a', '#6fdccb', '#edfffb', '#5ee3d0', 1.3, 1, 1.2, 0.2]
  };

  function hex(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function palette(name) {
    var p = PALETTES[name] || PALETTES.idle;
    return { core: hex(p[0]), mid: hex(p[1]), high: hex(p[2]), glow: hex(p[3]), speed: p[4], swirl: p[5], turb: p[6], react: p[7] };
  }

  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 res;uniform float time,radius,level,pulse,swirl,turb,intensity,swirlPhase,saturation;',
    'uniform vec3 core,midc,high,glowc;',
    'float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}',
    'float vnoise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);',
    ' return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),',
    '  mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);}',
    'const mat3 OCT_ROT=mat3(vec3(0.00,0.80,0.60),vec3(-0.80,0.36,-0.48),vec3(-0.60,-0.48,0.64));',
    'float fbm4(vec3 p){float s=0.0,a=0.5,n=0.0;for(int i=0;i<4;i++){s+=a*vnoise(p);n+=a;p=OCT_ROT*p*2.03;a*=0.5;}return s/n;}',
    'float fbm5(vec3 p){float s=0.0,a=0.5,n=0.0;for(int i=0;i<5;i++){s+=a*vnoise(p);n+=a;p=OCT_ROT*p*2.03;a*=0.5;}return s/n;}',
    'float haloWindow(float d,float start,float end){float e=min(end,0.98);return 1.0-smoothstep(min(start,e-0.02),e,d);}',
    'vec2 rot2(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}',
    'void main(){',
    ' vec2 p=(gl_FragCoord.xy/res)*2.0-1.0;float R=radius*(1.0+pulse);vec2 q=p/R;float r=length(q);float t=time;',
    ' float e=max(r-1.0,0.0);float ring=exp(-e*8.0);',
    ' float wide=exp(-e*(2.5-level*0.8))*(0.72+0.28*clamp(q.y/max(r,1e-3),-1.0,1.0));',
    ' vec3 haloCol=mix(glowc,vec3(1.0,0.93,0.95),ring*0.7);',
    ' float haloA=clamp(ring*0.72+wide*(0.62+level*0.25),0.0,1.0)*clamp(intensity,0.0,1.6)*0.82;',
    ' haloA*=haloWindow(length(p),0.6*(1.0+pulse),0.98*(1.0+pulse));vec4 halo=vec4(haloCol*haloA,haloA);',
    ' if(r>1.0){gl_FragColor=halo;return;}',
    ' float z=sqrt(max(0.0,1.0-r*r));float twist=swirl*(1.0-r*r)*(1.4+0.6*sin(t*0.35));',
    ' vec2 sq=rot2(q,t*0.10+twist+swirlPhase);vec3 sp=vec3(sq*1.15,z*0.55);',
    ' float warpAmt=1.25+turb*0.9+level*1.3;',
    ' vec3 w1=vec3(fbm4(sp*1.3+vec3(0.0,0.0,t*0.22)),fbm4(sp*1.3+vec3(3.1,7.7,t*0.22)),fbm4(sp*1.3+vec3(6.3,2.2,-t*0.18)));',
    ' vec3 w2=vec3(fbm4(sp*2.1+w1*2.0+vec3(1.2,4.4,t*0.31)),fbm4(sp*2.1+w1*2.0+vec3(8.3,2.8,t*0.27)),0.0);',
    ' float smoke=fbm5(sp*1.7+w2*warpAmt+vec3(0.0,0.0,t*0.17));float smokeFar=fbm4(sp*3.1+w1*1.4-vec3(0.0,0.0,t*0.26)+5.0);',
    ' float lit=clamp(dot(q,normalize(vec2(0.62,-0.78)))*0.55+0.45,0.0,1.0);',
    ' float d=q.y+0.22-0.62*q.x+0.18*q.x*q.x+(w2.x-0.5)*0.55+sin(t*0.2)*0.04;',
    ' float streak=exp(-d*d*26.0)*smoothstep(-0.7,0.35,q.x);float fd=d+0.09+(smokeFar-0.5)*0.3;',
    ' float streakFine=exp(-(fd*fd)*120.0)*smoothstep(-0.2,0.6,q.x);',
    ' vec3 col=mix(core,midc,smoothstep(0.30,0.95,smoke*0.75+lit*0.55));',
    ' col=mix(col,high,smoothstep(0.62,1.05,lit*0.8+smokeFar*0.45)*0.9);',
    ' col=mix(col,high,clamp(streak*(0.55+0.45*smoke)+streakFine*0.6,0.0,1.0));',
    ' col+=(smokeFar-0.5)*0.10+(smoke-0.5)*0.06;',
    ' float fres=pow(1.0-z,2.4);col=mix(col,mix(glowc,vec3(1.0),0.55),fres*0.42);',
    ' col*=0.94+0.10*z+0.22*level;col=mix(col,col*(0.85+0.3*intensity),0.5);',
    ' col=mix(vec3(dot(col,vec3(0.2126,0.7152,0.0722))),col,saturation);col=clamp(col,0.0,1.0);',
    ' float a=1.0-smoothstep(1.0-2.5/(res.y*radius),1.0,r);gl_FragColor=vec4(col,1.0)*a+halo*(1.0-a);}'
  ].join('\n');

  function create(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return null;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { console.warn('JosieOrb:', e); return null; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    var U = {};
    ['res', 'time', 'radius', 'level', 'pulse', 'swirl', 'turb', 'intensity', 'swirlPhase', 'saturation', 'core', 'midc', 'high', 'glowc']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cur = palette(opts.state || 'idle'), target = cur, state = opts.state || 'idle';
    var time = 0, phase = 0, level = 0, last = 0, raf = 0, dead = false, visible = true;
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }) : null;
    if (io) io.observe(canvas);

    function lerp(a, b, k) { return a + (b - a) * k; }
    function lerp3(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }

    function frame(ts) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      if (!visible || document.hidden) return;
      var k = 1 - Math.pow(1 - BLEND_K, dt * 60);
      cur = { core: lerp3(cur.core, target.core, k), mid: lerp3(cur.mid, target.mid, k), high: lerp3(cur.high, target.high, k),
        glow: lerp3(cur.glow, target.glow, k), speed: lerp(cur.speed, target.speed, k), swirl: lerp(cur.swirl, target.swirl, k),
        turb: lerp(cur.turb, target.turb, k), react: lerp(cur.react, target.react, k) };
      // No microphone on a web page: a speech-like envelope stands in for the audio level while talking.
      var talking = state === 'speaking' || state === 'userSpeaking';
      var raw = talking ? (0.35 + 0.35 * Math.sin(ts / 170) * Math.sin(ts / 410 + 1.3) + 0.2 * Math.sin(ts / 90)) * cur.react : 0;
      level += (Math.max(0, raw) - level) * (1 - Math.exp(-dt / (raw > level ? 0.012 : 0.12)));
      var flow = dt * cur.speed * (1 + level * 0.8) * (reduce ? 0.25 : 1);
      time += flow;
      phase = (phase + flow * cur.swirl * 0.45) % (2 * Math.PI);

      var scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
      var w = Math.max(1, Math.round(canvas.clientWidth * scale)), h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.radius, RADIUS);
      gl.uniform1f(U.level, level);
      gl.uniform1f(U.pulse, level * 0.06);
      gl.uniform1f(U.swirl, cur.swirl);
      gl.uniform1f(U.turb, cur.turb);
      gl.uniform1f(U.intensity, 1);
      gl.uniform1f(U.swirlPhase, phase);
      gl.uniform1f(U.saturation, 1);
      gl.uniform3fv(U.core, cur.core);
      gl.uniform3fv(U.midc, cur.mid);
      gl.uniform3fv(U.high, cur.high);
      gl.uniform3fv(U.glowc, cur.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    raf = requestAnimationFrame(frame);
    return {
      setState: function (name) { state = name; target = palette(name); },
      destroy: function () { dead = true; cancelAnimationFrame(raf); if (io) io.disconnect(); }
    };
  }

  window.JosieOrb = { create: create, glow: function (name) { return (PALETTES[name] || PALETTES.idle)[3]; } };
})();
