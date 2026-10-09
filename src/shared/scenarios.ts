// Role-play scenarios on Today: an everyday situation where the tutor plays a part (server, shop assistant, ...).
// The session is a normal chat with `SessionMeta.scenarioId`; the tutor opens in role. No runtime deps.
import { msg } from "./i18n";

/** Names in the renderer's icon set (components/icons.tsx). */
export type ScenarioIcon =
  | "utensils" | "cup" | "bag" | "cart" | "pin" | "bed" | "train" | "heart"
  | "phone" | "receipt" | "user" | "briefcase" | "home" | "plane" | "pill" | "door";

export interface Scenario {
  id: string;
  icon: ScenarioIcon;
  /** Learner-visible; translated with t(). Also the session title. */
  title: string;
  description: string;
  /** English, for the tutor prompt: the scene and who plays whom. */
  setup: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "restaurant",
    icon: "utensils",
    title: msg("Order at a restaurant"),
    description: msg("The tutor is your server"),
    setup: "A sit-down restaurant. You are the server; the learner is a guest. Greet them, offer the menu, take their order, answer questions about dishes, and bring the bill when they ask.",
  },
  {
    id: "cafe",
    icon: "cup",
    title: msg("Order a coffee"),
    description: msg("Sizes, milk, to stay or to go"),
    setup: "A busy café counter. You are the barista; the learner is a customer. Take their order, ask about size, milk and whether it is to stay or to go, and tell them the price.",
  },
  {
    id: "shop-help",
    icon: "bag",
    title: msg("Ask a shop assistant"),
    description: msg("Find a size, a colour, a price"),
    setup: "A clothes shop. You are a shop assistant; the learner is a customer looking for something. Help them find it, talk about sizes, colours and prices, and point them to the fitting room.",
  },
  {
    id: "supermarket",
    icon: "cart",
    title: msg("At the checkout"),
    description: msg("Ask the cashier for help"),
    setup: "A supermarket checkout. You are the cashier; the learner is a customer. Scan their items, ask if they need a bag, and handle a small problem (a missing price, a card that does not work, a coupon).",
  },
  {
    id: "directions",
    icon: "pin",
    title: msg("Ask for directions"),
    description: msg("Find your way in a new city"),
    setup: "A street in a city the learner does not know. You are a friendly local; the learner stops you to ask the way. Give clear directions with landmarks, and check that they understood.",
  },
  {
    id: "hotel",
    icon: "bed",
    title: msg("Check in at a hotel"),
    description: msg("Your booking, your room, breakfast"),
    setup: "A hotel front desk. You are the receptionist; the learner is arriving. Find their booking, explain the room, breakfast times and Wi-Fi, and deal with one small problem with the room.",
  },
  {
    id: "train",
    icon: "train",
    title: msg("Buy a train ticket"),
    description: msg("Times, platforms, a return"),
    setup: "A train station ticket office. You are the clerk; the learner wants to travel. Ask where and when, offer times and prices, single or return, and tell them the platform.",
  },
  {
    id: "doctor",
    icon: "heart",
    title: msg("See a doctor"),
    description: msg("Say what hurts and since when"),
    setup: "A doctor's office. You are the doctor; the learner is the patient. Ask what is wrong, since when and how it feels, then give simple advice. Keep it light: nothing serious.",
  },
  {
    id: "phone-booking",
    icon: "phone",
    title: msg("Book by phone"),
    description: msg("A table, a haircut, an appointment"),
    setup: "A phone call. You answer the phone at a hair salon; the learner calls to book. Find a day and time that works, ask for their name and number, and confirm the booking.",
  },
  {
    id: "return",
    icon: "receipt",
    title: msg("Return something"),
    description: msg("Explain what is wrong, ask for a refund"),
    setup: "The service desk of a shop. You are the staff member; the learner wants to return something they bought. Ask what is wrong, ask for the receipt, and offer a refund or an exchange.",
  },
  {
    id: "small-talk",
    icon: "user",
    title: msg("Meet someone new"),
    description: msg("Small talk at a party"),
    setup: "A friend's party. You are another guest the learner has not met. Introduce yourself and make small talk: where they are from, what they do, how they know the host, hobbies.",
  },
  {
    id: "interview",
    icon: "briefcase",
    title: msg("Job interview"),
    description: msg("Talk about your work and your goals"),
    setup: "A job interview. You are the interviewer; the learner is the candidate. Ask about their experience, strengths and goals, one question at a time, and let them ask you questions at the end.",
  },
  {
    id: "apartment",
    icon: "home",
    title: msg("Rent a flat"),
    description: msg("Ask the landlord the right questions"),
    setup: "Viewing a flat for rent. You are the landlord; the learner is interested in renting. Show the flat, answer questions about rent, bills, the neighbourhood and the move-in date.",
  },
  {
    id: "airport",
    icon: "plane",
    title: msg("At the airport"),
    description: msg("Check-in, bags, a delayed flight"),
    setup: "An airport check-in desk. You are the airline agent; the learner is a passenger. Check them in, ask about bags and seats, then tell them the flight is delayed and help them with it.",
  },
  {
    id: "pharmacy",
    icon: "pill",
    title: msg("At the pharmacy"),
    description: msg("Describe a cold, ask what to take"),
    setup: "A pharmacy. You are the pharmacist; the learner has a cold or a headache. Ask about symptoms, suggest something, and explain how often to take it.",
  },
  {
    id: "neighbour",
    icon: "door",
    title: msg("Talk to a neighbour"),
    description: msg("A parcel, some noise, a favour"),
    setup: "The hallway of an apartment building. You are the learner's neighbour. Chat, then bring up something small: a parcel you took in for them, or noise last night, or ask a favour.",
  },
];

export function findScenario(id: string | undefined): Scenario | undefined {
  return id ? SCENARIOS.find((s) => s.id === id) : undefined;
}
