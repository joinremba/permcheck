import { expect, test } from "bun:test";
import { gate } from "./index";

test("gate", () => {
  expect(gate()).toBe("gate");
});
