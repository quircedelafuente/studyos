import type { CourseMock } from "@/types/dashboard";

export const MOCK_COURSES: CourseMock[] = [
  {
    id: "alg",
    name: "Álgebra lineal",
    short: "ALG",
    accent: "#d4d4d8",
    files: [
      {
        id: "alg-1",
        name: "Guía determinantes.pdf",
        kind: "pdf",
        updatedAt: "2026-03-20",
        pinned: true,
      },
      {
        id: "alg-2",
        name: "Apuntes semana 8.md",
        kind: "nota",
        updatedAt: "2026-03-18",
      },
    ],
  },
  {
    id: "prog",
    name: "Programación",
    short: "PRG",
    accent: "#e4e4e7",
    files: [
      {
        id: "prog-1",
        name: "Enunciado proyecto.pdf",
        kind: "pdf",
        updatedAt: "2026-03-25",
        pinned: true,
      },
      {
        id: "prog-2",
        name: "Diapos intro Next.js",
        kind: "slide",
        updatedAt: "2026-03-10",
      },
    ],
  },
  {
    id: "fis",
    name: "Física I",
    short: "FIS",
    accent: "#a1a1aa",
    files: [
      {
        id: "fis-1",
        name: "Formulario examen.pdf",
        kind: "pdf",
        updatedAt: "2026-03-22",
      },
      {
        id: "fis-2",
        name: "Simulacro resuelto",
        kind: "enlace",
        updatedAt: "2026-03-15",
      },
    ],
  },
  {
    id: "lit",
    name: "Literatura",
    short: "LIT",
    accent: "#f4f4f5",
    files: [
      {
        id: "lit-1",
        name: "Guía ensayo final.pdf",
        kind: "pdf",
        updatedAt: "2026-03-12",
      },
    ],
  },
];

export const MOCK_CLI_LINES = [
  { role: "system" as const, text: "Notebook LM CLI — mockup (sin backend)." },
  { role: "user" as const, text: "resume los PDF de Álgebra de esta semana" },
  {
    role: "assistant" as const,
    text: "Listo para conectar: aquí irá la respuesta del modelo indexando tus fuentes.",
  },
];
