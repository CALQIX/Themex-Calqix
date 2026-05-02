(() => {
  if (typeof window.confetti === 'function') return;

  let canvas;
  let context;
  let pieces = [];
  let frame;

  const colors = ['#D4B46E', '#FAF7EF', '#FFFFFF', '#C9A55A'];

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '2147483647';
    context = canvas.getContext('2d');
    document.body.appendChild(canvas);
    resize();
  }

  function resize() {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function createPieces(options) {
    const count = Math.max(1, Math.min(options.particleCount || 80, 160));
    const origin = options.origin || { x: 0.5, y: 0 };
    const scalar = options.scalar || 1;
    const spread = ((options.spread || 60) * Math.PI) / 180;
    const startAngle = Math.PI / 2;
    const startX = window.innerWidth * (origin.x == null ? 0.5 : origin.x);
    const startY = window.innerHeight * (origin.y == null ? 0 : origin.y);

    for (let index = 0; index < count; index += 1) {
      const angle = startAngle + (Math.random() - 0.5) * spread;
      const velocity = 4 + Math.random() * 5;
      pieces.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity + 2,
        size: (5 + Math.random() * 5) * scalar,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.25,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 90 + Math.random() * 40,
        age: 0,
      });
    }
  }

  function drawPiece(piece) {
    context.save();
    context.translate(piece.x, piece.y);
    context.rotate(piece.rotation);
    context.fillStyle = piece.color;
    context.globalAlpha = Math.max(0, 1 - piece.age / piece.life);
    context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * 0.66);
    context.restore();
  }

  function tick() {
    if (!canvas || !context) return;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pieces = pieces.filter((piece) => piece.age < piece.life && piece.y < window.innerHeight + 40);

    pieces.forEach((piece) => {
      piece.age += 1;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.08;
      piece.vx *= 0.99;
      piece.rotation += piece.spin;
      drawPiece(piece);
    });

    if (pieces.length) {
      frame = window.requestAnimationFrame(tick);
    } else {
      window.cancelAnimationFrame(frame);
      frame = null;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  window.confetti = (options = {}) => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ensureCanvas();
    createPieces(options);
    if (!frame) frame = window.requestAnimationFrame(tick);
  };

  window.addEventListener('resize', resize, { passive: true });
})();
