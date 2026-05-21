import * as crypto from "crypto";

/**
 * 钉钉群机器人推送。
 * 参考：https://open.dingtalk.com/document/robots/customize-robot-security-settings
 *
 * 加签校验流程：
 *   sign = HMAC-SHA256(secret, `${timestamp}\n${secret}`) → base64
 *   URL: webhook?access_token=TOKEN&timestamp=TS&sign=URL_ENCODED_SIGN
 */

const WEBHOOK = "https://oapi.dingtalk.com/robot/send";

const generateSignature = (
  secret: string,
): { timestamp: number; sign: string } => {
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  return { timestamp, sign };
};

export interface DingTalkResult {
  ok: boolean;
  error?: string;
}

export const sendDingTalkMarkdown = async (
  accessToken: string,
  secret: string,
  title: string,
  text: string,
): Promise<DingTalkResult> => {
  if (!accessToken || !secret) {
    return { ok: false, error: "accessToken / secret 未配置" };
  }
  try {
    const { timestamp, sign } = generateSignature(secret);
    const url = `${WEBHOOK}?access_token=${encodeURIComponent(
      accessToken,
    )}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

    const message = {
      msgtype: "markdown",
      markdown: { title, text },
      at: { isAtAll: false },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    const data = (await res.json().catch(() => ({}))) as {
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode !== 0) {
      return {
        ok: false,
        error: `errcode=${data.errcode ?? "?"} errmsg=${data.errmsg ?? "?"}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};
