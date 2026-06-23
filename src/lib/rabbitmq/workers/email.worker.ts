import type { Emaildata } from "../config/types.ts";

async function emailWorker({ msg }: { msg: Emaildata }) {
  const { title, email, body } = msg;

  return { title, email, body };
}

export default emailWorker;
