// Development fixtures, not a production editorial catalogue.
export const questions = [
  {
    id: "q1",
    category: "geography",
    text: "Quelle est la capitale de la Tunisie ?",
    choices: ["Tunis", "Sfax", "Sousse", "Bizerte"],
    correctIndex: 0,
    difficulty: 1,
    explanation: "Tunis est la capitale de la Tunisie.",
  },
  {
    id: "q2",
    category: "science",
    text: "Quelle est la formule chimique de l’eau ?",
    choices: ["CO2", "H2O", "O2", "NaCl"],
    correctIndex: 1,
    difficulty: 1,
    explanation:
      "Une molécule d’eau comprend deux atomes d’hydrogène et un atome d’oxygène.",
  },
  {
    id: "q3",
    category: "maths",
    text: "Combien vaut 12 × 8 ?",
    choices: ["86", "88", "96", "108"],
    correctIndex: 2,
    difficulty: 1,
    explanation: "12 × 8 = 96.",
  },
  {
    id: "q4",
    category: "science",
    text: "Quelle planète est surnommée la planète rouge ?",
    choices: ["Vénus", "Jupiter", "Mercure", "Mars"],
    correctIndex: 3,
    difficulty: 1,
    explanation: "Mars est surnommée la planète rouge.",
  },
  {
    id: "q5",
    category: "maths",
    text: "Quelle est la racine carrée de 144 ?",
    choices: ["12", "14", "16", "18"],
    correctIndex: 0,
    difficulty: 2,
    explanation: "12 × 12 = 144.",
  },
];
export const publicQuestion = ({
  id,
  category,
  text,
  choices,
  difficulty,
}) => ({ id, category, text, choices, difficulty });
