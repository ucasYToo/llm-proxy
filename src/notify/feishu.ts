import * as crypto from "crypto";

/**
 * 飞书自定义机器人推送。
 * 参考：https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN
 *
 * 签名校验流程：
 *   sign = HMAC-SHA256(timestamp + "\n" + secret, "") → base64
 *   timestamp 和 sign 放在请求体中。
 */

const generateSignature = (
  secret: string,
): { timestamp: number; sign: string } => {
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac("sha256", stringToSign)
    .update("")
    .digest("base64");
  return { timestamp, sign };
};

export interface FeishuResult {
  ok: boolean;
  error?: string;
}

export const sendFeishuText = async (
  webhookUrl: string,
  secret: string,
  text: string,
): Promise<FeishuResult> => {
  if (!webhookUrl) {
    return { ok: false, error: "webhookUrl 未配置" };
  }
  try {
    const body: Record<string, unknown> = {
      msg_type: "text",
      content: { text },
    };

    if (secret) {
      const { timestamp, sign } = generateSignature(secret);
      body.timestamp = String(timestamp);
      body.sign = sign;
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
    };
    if (data.code !== 0) {
      return {
        ok: false,
        error: `code=${data.code ?? "?"} msg=${data.msg ?? "?"}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};
