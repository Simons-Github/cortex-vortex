export type Resource = {
  id: string;
  kind: "video" | "article";
  title: string;
  source: string;
  minutes: number;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  masteryGain: number;
};

export type ChatTurn = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

export type Topic = {
  id: string;
  title: string;
  category: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  mastery: number;
  decay: number;
  lastReviewed: string;
  nextReview: string;
  summary: string;
  conversation: ChatTurn[];
  quiz: QuizQuestion[];
  resources: Resource[];
};

export const levelFor = (mastery: number) =>
  mastery <= 30 ? "Beginner" : mastery <= 70 ? "Intermediate" : "Advanced";

export const topics: Topic[] = [
  {
    id: "algorithms",
    title: "Algorithms & Data Structures",
    category: "Computer Science",
    difficulty: "Advanced",
    mastery: 64,
    decay: 22,
    lastReviewed: "3 days ago",
    nextReview: "in 14 hours",
    summary:
      "Complexity analysis, graph traversal, dynamic programming and the trade-offs between the core data structures.",
    conversation: [
      {
        id: "a1",
        role: "assistant",
        text: "Dynamic programming is memoized recursion with intent. You identify overlapping subproblems, define a state, then decide whether to solve top-down (memoization) or bottom-up (tabulation).",
      },
      {
        id: "a2",
        role: "user",
        text: "Where does most of my decay come from?",
      },
      {
        id: "a3",
        role: "assistant",
        text: "Your weakest recall is on amortized analysis and on choosing between Dijkstra and Bellman-Ford. You consistently answer tree traversal questions correctly, so I will spend less time there.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "What is the average time complexity of a lookup in a balanced binary search tree?",
        options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
        correctIndex: 1,
        explanation:
          "A balanced BST halves the search space at every node, so the height stays proportional to log n and lookups follow the height.",
        masteryGain: 3,
      },
      {
        id: "q2",
        prompt: "Which algorithm handles graphs containing negative edge weights?",
        options: ["Dijkstra", "Bellman-Ford", "Kruskal", "Breadth-first search"],
        correctIndex: 1,
        explanation:
          "Bellman-Ford relaxes every edge V-1 times, which tolerates negative weights and can detect negative cycles. Dijkstra's greedy choice breaks down with negative edges.",
        masteryGain: 4,
      },
      {
        id: "q3",
        prompt: "Amortized insertion into a dynamic array that doubles on resize is:",
        options: ["O(1)", "O(log n)", "O(n)", "O(n²)"],
        correctIndex: 0,
        explanation:
          "Doubling makes the expensive copies rare enough that the cost spread across all insertions is constant.",
        masteryGain: 3,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "video",
        title: "Dynamic Programming, intuitively",
        source: "MIT OCW",
        minutes: 24,
      },
      {
        id: "r2",
        kind: "article",
        title: "Amortized analysis without the hand-waving",
        source: "Cortex Digest",
        minutes: 9,
      },
      {
        id: "r3",
        kind: "video",
        title: "Dijkstra vs Bellman-Ford",
        source: "Graph Theory Lab",
        minutes: 16,
      },
    ],
  },
  {
    id: "react",
    title: "React 19 & TypeScript",
    category: "Frontend",
    difficulty: "Intermediate",
    mastery: 81,
    decay: 9,
    lastReviewed: "yesterday",
    nextReview: "in 4 days",
    summary:
      "Concurrent rendering, the compiler, server components and typing component contracts precisely.",
    conversation: [
      {
        id: "b1",
        role: "assistant",
        text: "React 19 shifts the mental model: transitions describe urgency, actions describe intent, and the compiler removes most manual memoization.",
      },
      {
        id: "b2",
        role: "user",
        text: "Simplify explanation",
      },
      {
        id: "b3",
        role: "assistant",
        text: "You tell React what matters right now. Everything else waits. And you stop writing useMemo by hand.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "What does useTransition primarily give you?",
        options: [
          "A way to mark updates as non-urgent",
          "A way to cancel network requests",
          "A replacement for useEffect",
          "Automatic server rendering",
        ],
        correctIndex: 0,
        explanation:
          "useTransition marks a state update as low priority so urgent input stays responsive while the heavier render is prepared.",
        masteryGain: 2,
      },
      {
        id: "q2",
        prompt: "In TypeScript, which utility type makes every property optional?",
        options: ["Required<T>", "Readonly<T>", "Partial<T>", "Pick<T, K>"],
        correctIndex: 2,
        explanation: "Partial<T> maps each property of T to an optional variant of itself.",
        masteryGain: 2,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "article",
        title: "The React compiler in practice",
        source: "React Digest",
        minutes: 12,
      },
      {
        id: "r2",
        kind: "video",
        title: "Typing component props properly",
        source: "TS Deep Dive",
        minutes: 18,
      },
    ],
  },
  {
    id: "architecture",
    title: "Computer Architecture",
    category: "Computer Science",
    difficulty: "Advanced",
    mastery: 27,
    decay: 41,
    lastReviewed: "2 weeks ago",
    nextReview: "overdue",
    summary: "Pipelines, cache hierarchies, branch prediction and the memory wall.",
    conversation: [
      {
        id: "c1",
        role: "assistant",
        text: "Most performance intuition collapses into one question: did the data fit in cache? Latency between L1 and main memory differs by roughly two orders of magnitude.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "A cache miss that occurs on the very first access to a block is called:",
        options: ["Conflict miss", "Capacity miss", "Compulsory miss", "Coherence miss"],
        correctIndex: 2,
        explanation:
          "Compulsory (cold) misses are unavoidable the first time a block is referenced.",
        masteryGain: 5,
      },
      {
        id: "q2",
        prompt: "Pipelining primarily improves:",
        options: [
          "Latency of a single instruction",
          "Throughput of instructions",
          "Cache size",
          "Branch accuracy",
        ],
        correctIndex: 1,
        explanation:
          "Each instruction still takes the same time end to end, but overlapping stages lets more instructions complete per unit time.",
        masteryGain: 5,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "video",
        title: "The memory hierarchy explained",
        source: "Silicon Notes",
        minutes: 21,
      },
      {
        id: "r2",
        kind: "article",
        title: "Why branch prediction matters",
        source: "Cortex Digest",
        minutes: 8,
      },
    ],
  },
  {
    id: "distributed",
    title: "Distributed Systems",
    category: "Backend",
    difficulty: "Advanced",
    mastery: 48,
    decay: 30,
    lastReviewed: "5 days ago",
    nextReview: "in 2 days",
    summary: "Consensus, replication, partial failure and the consistency spectrum.",
    conversation: [
      {
        id: "d1",
        role: "assistant",
        text: "Consensus is not about agreeing on truth, it is about agreeing on order despite failures. Raft makes that legible by electing a leader and replicating a log.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "In the CAP theorem, what must a partitioned system trade off?",
        options: [
          "Consistency against availability",
          "Latency against throughput",
          "Durability against speed",
          "Cost against safety",
        ],
        correctIndex: 0,
        explanation:
          "During a network partition a system can either refuse requests to stay consistent, or answer them and risk divergence.",
        masteryGain: 4,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "article",
        title: "Raft, in plain language",
        source: "Systems Weekly",
        minutes: 14,
      },
    ],
  },
  {
    id: "linear-algebra",
    title: "Linear Algebra for ML",
    category: "Mathematics",
    difficulty: "Intermediate",
    mastery: 72,
    decay: 12,
    lastReviewed: "2 days ago",
    nextReview: "in 6 days",
    summary: "Vector spaces, eigendecomposition and why gradients live in dual space.",
    conversation: [
      {
        id: "e1",
        role: "assistant",
        text: "An eigenvector is a direction the transformation does not rotate. It only stretches. The eigenvalue is that stretch factor.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "If Av = λv, then v is:",
        options: ["An eigenvalue", "An eigenvector", "A determinant", "A null space"],
        correctIndex: 1,
        explanation:
          "v is the eigenvector; λ is the scalar eigenvalue describing how much v is scaled.",
        masteryGain: 3,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "video",
        title: "Eigenvectors, visually",
        source: "Vector Lab",
        minutes: 17,
      },
    ],
  },
  {
    id: "security",
    title: "Applied Cryptography",
    category: "Security",
    difficulty: "Beginner",
    mastery: 19,
    decay: 55,
    lastReviewed: "3 weeks ago",
    nextReview: "overdue",
    summary: "Hashing, symmetric and asymmetric primitives, and key exchange.",
    conversation: [
      {
        id: "f1",
        role: "assistant",
        text: "A hash is one-way and fixed-width. Encryption is reversible with a key. Confusing the two is the single most common beginner mistake.",
      },
    ],
    quiz: [
      {
        id: "q1",
        prompt: "Which of these is a key exchange protocol?",
        options: ["SHA-256", "Diffie-Hellman", "AES-GCM", "bcrypt"],
        correctIndex: 1,
        explanation:
          "Diffie-Hellman lets two parties derive a shared secret over an untrusted channel without transmitting the secret itself.",
        masteryGain: 6,
      },
    ],
    resources: [
      {
        id: "r1",
        kind: "article",
        title: "Hashing is not encryption",
        source: "Cortex Digest",
        minutes: 6,
      },
    ],
  },
];

/** Decorative dashboard numbers for pure first-visit / logged-out demo only — never persist. */
export const dashboardStats = {
  decay: 34,
  streak: 5,
  activeTopics: topics.length,
  masteryRetained: Math.round(topics.reduce((a, t) => a + t.mastery, 0) / topics.length),
  nextReview: "14h",
};

export const difficulties = ["All", "Beginner", "Intermediate", "Advanced"] as const;
