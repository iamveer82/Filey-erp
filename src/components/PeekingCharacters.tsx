import { useEffect, useRef, useState, type RefObject } from "react";

/* Playful login scene: blocky characters whose eyes track the cursor,
 * blink at random, glance at each other while you type, and (the purple
 * one) sneak a peek when the password is revealed. Decorative only. */

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil = ({
  size = 12,
  maxDistance = 5,
  pupilColor = "#2D2D2D",
  forceLookX,
  forceLookY,
}: PupilProps) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  const pos = () => {
    if (forceLookX !== undefined && forceLookY !== undefined)
      return { x: forceLookX, y: forceLookY };
    if (!ref.current) return { x: 0, y: 0 };
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist };
  };
  const p = pos();

  return (
    <div
      ref={ref}
      className="rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: pupilColor,
        transform: `translate(${p.x}px, ${p.y}px)`,
        transition: "transform 0.1s ease-out",
      }}
    />
  );
};

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall = ({
  size = 18,
  pupilSize = 7,
  maxDistance = 5,
  eyeColor = "white",
  pupilColor = "#2D2D2D",
  isBlinking = false,
  forceLookX,
  forceLookY,
}: EyeBallProps) => {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  const pos = () => {
    if (forceLookX !== undefined && forceLookY !== undefined)
      return { x: forceLookX, y: forceLookY };
    if (!ref.current) return { x: 0, y: 0 };
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const a = Math.atan2(dy, dx);
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist };
  };
  const p = pos();

  return (
    <div
      className="flex items-center justify-center rounded-full transition-all duration-150"
      ref={ref}
      style={{
        width: size,
        height: isBlinking ? 2 : size,
        backgroundColor: eyeColor,
        overflow: "hidden",
      }}
    >
      {!isBlinking && (
        <div
          className="rounded-full"
          style={{
            width: pupilSize,
            height: pupilSize,
            backgroundColor: pupilColor,
            transform: `translate(${p.x}px, ${p.y}px)`,
            transition: "transform 0.1s ease-out",
          }}
        />
      )}
    </div>
  );
};

export default function PeekingCharacters({
  typing = false,
  passwordLength = 0,
  passwordVisible = false,
}: {
  typing?: boolean;
  passwordLength?: number;
  passwordVisible?: boolean;
}) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [purpleBlink, setPurpleBlink] = useState(false);
  const [blackBlink, setBlackBlink] = useState(false);
  const [lookEachOther, setLookEachOther] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  const revealed = passwordLength > 0 && passwordVisible;
  const hiding = typing || (passwordLength > 0 && !passwordVisible);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  // random blinks
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setPurpleBlink(true);
        setTimeout(() => {
          setPurpleBlink(false);
          loop();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    loop();
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlackBlink(true);
        setTimeout(() => {
          setBlackBlink(false);
          loop();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // glance at each other when typing starts
  useEffect(() => {
    if (!typing) {
      setLookEachOther(false);
      return;
    }
    setLookEachOther(true);
    const t = setTimeout(() => setLookEachOther(false), 800);
    return () => clearTimeout(t);
  }, [typing]);

  // purple sneaks a peek when the password is visible
  useEffect(() => {
    if (!revealed) {
      setPeeking(false);
      return;
    }
    const t = setTimeout(() => {
      setPeeking(true);
      setTimeout(() => setPeeking(false), 800);
    }, Math.random() * 3000 + 2000);
    return () => clearTimeout(t);
  }, [revealed, peeking]);

  const calc = (ref: RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const r = ref.current.getBoundingClientRect();
    const dx = mouseX - (r.left + r.width / 2);
    const dy = mouseY - (r.top + r.height / 3);
    return {
      faceX: Math.max(-15, Math.min(15, dx / 20)),
      faceY: Math.max(-10, Math.min(10, dy / 30)),
      bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
    };
  };

  const purple = calc(purpleRef);
  const black = calc(blackRef);
  const yellow = calc(yellowRef);
  const orange = calc(orangeRef);

  return (
    <div
      className="relative"
      style={{ width: 460, height: 360, maxWidth: "100%" }}
    >
      {/* Purple — back */}
      <div
        ref={purpleRef}
        className="absolute bottom-0 transition-all duration-700 ease-in-out"
        style={{
          left: 60,
          width: 150,
          height: hiding ? 370 : 340,
          backgroundColor: "#6C3FF5",
          borderRadius: "10px 10px 0 0",
          zIndex: 1,
          transform: revealed
            ? "skewX(0deg)"
            : hiding
            ? `skewX(${purple.bodySkew - 12}deg) translateX(40px)`
            : `skewX(${purple.bodySkew}deg)`,
          transformOrigin: "bottom center",
        }}
      >
        <div
          className="absolute flex gap-7 transition-all duration-700 ease-in-out"
          style={{
            left: revealed ? 18 : lookEachOther ? 48 : 38 + purple.faceX,
            top: revealed ? 32 : lookEachOther ? 58 : 36 + purple.faceY,
          }}
        >
          {[0, 1].map((k) => (
            <EyeBall
              key={k}
              size={18}
              pupilSize={7}
              isBlinking={purpleBlink}
              forceLookX={revealed ? (peeking ? 4 : -4) : lookEachOther ? 3 : undefined}
              forceLookY={revealed ? (peeking ? 5 : -4) : lookEachOther ? 4 : undefined}
            />
          ))}
        </div>
      </div>

      {/* Black — middle */}
      <div
        ref={blackRef}
        className="absolute bottom-0 transition-all duration-700 ease-in-out"
        style={{
          left: 200,
          width: 104,
          height: 264,
          backgroundColor: "#2D2D2D",
          borderRadius: "8px 8px 0 0",
          zIndex: 2,
          transform: revealed
            ? "skewX(0deg)"
            : lookEachOther
            ? `skewX(${black.bodySkew * 1.5 + 10}deg) translateX(18px)`
            : `skewX(${black.bodySkew * 1.5}deg)`,
          transformOrigin: "bottom center",
        }}
      >
        <div
          className="absolute flex gap-5 transition-all duration-700 ease-in-out"
          style={{
            left: revealed ? 9 : lookEachOther ? 28 : 22 + black.faceX,
            top: revealed ? 24 : lookEachOther ? 10 : 28 + black.faceY,
          }}
        >
          {[0, 1].map((k) => (
            <EyeBall
              key={k}
              size={15}
              pupilSize={6}
              maxDistance={4}
              isBlinking={blackBlink}
              forceLookX={revealed ? -4 : lookEachOther ? 0 : undefined}
              forceLookY={revealed ? -4 : lookEachOther ? -4 : undefined}
            />
          ))}
        </div>
      </div>

      {/* Orange — front left */}
      <div
        ref={orangeRef}
        className="absolute bottom-0 transition-all duration-700 ease-in-out"
        style={{
          left: 0,
          width: 200,
          height: 168,
          backgroundColor: "#FF9B6B",
          borderRadius: "100px 100px 0 0",
          zIndex: 3,
          transform: revealed ? "skewX(0deg)" : `skewX(${orange.bodySkew}deg)`,
          transformOrigin: "bottom center",
        }}
      >
        <div
          className="absolute flex gap-7 transition-all duration-200 ease-out"
          style={{
            left: revealed ? 42 : 70 + orange.faceX,
            top: revealed ? 72 : 76 + orange.faceY,
          }}
        >
          <Pupil forceLookX={revealed ? -5 : undefined} forceLookY={revealed ? -4 : undefined} />
          <Pupil forceLookX={revealed ? -5 : undefined} forceLookY={revealed ? -4 : undefined} />
        </div>
      </div>

      {/* Yellow — front right */}
      <div
        ref={yellowRef}
        className="absolute bottom-0 transition-all duration-700 ease-in-out"
        style={{
          left: 262,
          width: 120,
          height: 196,
          backgroundColor: "#E8D754",
          borderRadius: "60px 60px 0 0",
          zIndex: 4,
          transform: revealed ? "skewX(0deg)" : `skewX(${yellow.bodySkew}deg)`,
          transformOrigin: "bottom center",
        }}
      >
        <div
          className="absolute flex gap-5 transition-all duration-200 ease-out"
          style={{
            left: revealed ? 18 : 44 + yellow.faceX,
            top: revealed ? 30 : 34 + yellow.faceY,
          }}
        >
          <Pupil forceLookX={revealed ? -5 : undefined} forceLookY={revealed ? -4 : undefined} />
          <Pupil forceLookX={revealed ? -5 : undefined} forceLookY={revealed ? -4 : undefined} />
        </div>
        <div
          className="absolute h-[4px] w-16 rounded-full bg-[#2D2D2D] transition-all duration-200 ease-out"
          style={{
            left: revealed ? 10 : 34 + yellow.faceX,
            top: revealed ? 74 : 74 + yellow.faceY,
          }}
        />
      </div>
    </div>
  );
}
