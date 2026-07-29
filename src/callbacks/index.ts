import { Composer } from "grammy";
import type { CustomContext } from "../types";

import getMail from "./getMail";

const composer = new Composer<CustomContext>();

composer.use(getMail);

export default composer;
