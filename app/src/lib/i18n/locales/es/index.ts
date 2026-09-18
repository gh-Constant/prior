import type { AppDictionary } from "../en/index";
import { agent } from "./agent";
import { auth } from "./auth";
import { collab } from "./collab";
import { common } from "./common";
import { habits } from "./habits";
import { notes } from "./notes";
import { settings } from "./settings";
import { tasks } from "./tasks";

export const es: AppDictionary = { agent, auth, collab, common, habits, notes, settings, tasks };
