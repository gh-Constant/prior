import type { Language } from "../language";
import { de } from "./de/index";
import { en, type AppDictionary } from "./en/index";
import { es } from "./es/index";
import { fr } from "./fr/index";
import { pt } from "./pt/index";

export const dictionaries: Record<Language, AppDictionary> = { en, fr, es, de, pt };

export type { AppDictionary };
