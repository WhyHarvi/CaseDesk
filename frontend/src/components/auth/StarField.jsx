import { useEffect, useRef } from "react";

const STAR_COUNT = 160;
const SHOOTING_STAR_MIN_DELAY = 2200;
const SHOOTING_STAR_MAX_DELAY = 6000;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export default function StarField({ className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let stars = [];
    let shootingStars = [];
    let nextShootingStarAt = 0;
    let frame;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: STAR_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: randomBetween(0.5, 1.6),
        baseAlpha: randomBetween(0.25, 0.9),
        phase: Math.random() * Math.PI * 2,
        speed: randomBetween(0.4, 1.1),
      }));
    }

    function spawnShootingStar() {
      shootingStars.push({
        x: randomBetween(width * 0.1, width * 0.9),
        y: randomBetween(-20, height * 0.3),
        vx: randomBetween(6, 10),
        vy: randomBetween(7, 11),
        life: 0,
        maxLife: randomBetween(28, 44),
      });
    }

    function draw(time) {
      ctx.clearRect(0, 0, width, height);

      for (const star of stars) {
        const twinkle = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(star.phase + time * 0.001 * star.speed);
        ctx.beginPath();
        ctx.globalAlpha = star.baseAlpha * twinkle;
        ctx.fillStyle = "#ffffff";
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (reduceMotion) return;

      shootingStars = shootingStars.filter((star) => star.life < star.maxLife);
      for (const star of shootingStars) {
        star.life += 1;
        star.x += star.vx;
        star.y += star.vy;
        const progress = star.life / star.maxLife;
        const alpha = Math.sin(Math.PI * Math.min(progress, 1));
        const tailX = star.x - star.vx * 3.2;
        const tailY = star.y - star.vy * 3.2;
        const gradient = ctx.createLinearGradient(tailX, tailY, star.x, star.y);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, `rgba(255,255,255,${alpha})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(star.x, star.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.arc(star.x, star.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (time >= nextShootingStarAt) {
        spawnShootingStar();
        nextShootingStarAt = time + randomBetween(SHOOTING_STAR_MIN_DELAY, SHOOTING_STAR_MAX_DELAY);
      }

      frame = requestAnimationFrame(draw);
    }

    function handleResize() {
      resize();
      draw(performance.now());
    }

    resize();
    window.addEventListener("resize", handleResize);
    nextShootingStarAt = performance.now() + randomBetween(500, 2000);
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
