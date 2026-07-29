import type { CustomContext } from "../types";
import { Composer } from "grammy";
import { settingsMenu } from "./settings";
import { addressMenu } from "./settings/address";
import { buyerNameMenu } from "./settings/buyerName";

const menusConv = new Composer<CustomContext>();

menusConv.use(settingsMenu);
menusConv.use(addressMenu);
menusConv.use(buyerNameMenu);

export default menusConv;
