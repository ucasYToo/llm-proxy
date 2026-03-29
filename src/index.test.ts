import program from "./index";

describe("program", () => {
  it("should return the expected word", () => {
    const expected = "Write your own legend...";
    const result = program();
    expect(result).toBe(expected);
  });
});
