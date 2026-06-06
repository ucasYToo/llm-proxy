import { useState } from "react";
import type { NotificationSettings } from "../../lib/api";
import {
  testDingTalk,
  testFeishu,
  updateNotifications,
} from "../../lib/api";

interface UseNotificationsParams {
  notifications: NotificationSettings;
  onRefresh: () => void;
}

const eventsAnyOn = (e?: {
  stop?: boolean;
  subagentStop?: boolean;
  notification?: boolean;
}) => !!(e?.stop || e?.subagentStop || e?.notification);

export function useNotifications({ notifications, onRefresh }: UseNotificationsParams) {
  const [dingtalkOpen, setDingtalkOpen] = useState(false);
  const [feishuOpen, setFeishuOpen] = useState(false);
  const [macosOpen, setMacosOpen] = useState(false);
  const [dingSaving, setDingSaving] = useState(false);
  const [dingTesting, setDingTesting] = useState(false);
  const [feishuSaving, setFeishuSaving] = useState(false);
  const [feishuTesting, setFeishuTesting] = useState(false);

  const macos = notifications.macos ?? {};
  const dingtalk = notifications.dingtalk ?? {};
  const feishu = notifications.feishu ?? {};

  const macosArmed = !!macos.enabled && eventsAnyOn(macos.events);
  const dingtalkArmed =
    !!dingtalk.enabled &&
    eventsAnyOn(dingtalk.events) &&
    !!dingtalk.accessToken &&
    !!dingtalk.secret;
  const feishuArmed =
    !!feishu.enabled &&
    eventsAnyOn(feishu.events) &&
    !!feishu.webhookUrl &&
    !!feishu.secret;

  const handleToggleMacos = async (enabled: boolean) => {
    try {
      await updateNotifications({ macos: { enabled } });
      onRefresh();
    } catch (e) {
      alert("更新 macOS 通知失败：" + String(e));
    }
  };

  const handleChangeMacosEvents = async (events: {
    stop?: boolean;
    subagentStop?: boolean;
    notification?: boolean;
  }) => {
    try {
      await updateNotifications({ macos: { events } });
      onRefresh();
    } catch (e) {
      alert("更新 macOS 事件失败：" + String(e));
    }
  };

  const handleToggleDingTalk = async (enabled: boolean) => {
    try {
      await updateNotifications({ dingtalk: { enabled } });
      onRefresh();
    } catch (e) {
      alert("更新钉钉通知失败：" + String(e));
    }
  };

  const handleChangeDingtalkEvents = async (events: {
    stop?: boolean;
    subagentStop?: boolean;
    notification?: boolean;
  }) => {
    try {
      await updateNotifications({ dingtalk: { events } });
      onRefresh();
    } catch (e) {
      alert("更新钉钉事件失败：" + String(e));
    }
  };

  const handleSaveDingTalk = async (accessToken: string, secret: string) => {
    setDingSaving(true);
    try {
      await updateNotifications({ dingtalk: { accessToken, secret } });
      onRefresh();
    } catch (e) {
      alert("保存钉钉配置失败：" + String(e));
    } finally {
      setDingSaving(false);
    }
  };

  const handleTestDingTalk = async (accessToken: string, secret: string) => {
    setDingTesting(true);
    try {
      await testDingTalk(accessToken, secret);
      alert("已发送测试消息，请到钉钉群确认");
    } catch (e) {
      alert("钉钉测试失败：" + String(e));
    } finally {
      setDingTesting(false);
    }
  };

  const handleToggleFeishu = async (enabled: boolean) => {
    try {
      await updateNotifications({ feishu: { enabled } });
      onRefresh();
    } catch (e) {
      alert("更新飞书通知失败：" + String(e));
    }
  };

  const handleSaveFeishu = async (webhookUrl: string, secret: string) => {
    setFeishuSaving(true);
    try {
      await updateNotifications({ feishu: { webhookUrl, secret } });
      onRefresh();
    } finally {
      setFeishuSaving(false);
    }
  };

  const handleTestFeishu = async (webhookUrl: string, secret: string) => {
    setFeishuTesting(true);
    try {
      await testFeishu(webhookUrl, secret);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setFeishuTesting(false);
    }
  };

  const handleChangeFeishuEvents = async (events: {
    stop?: boolean;
    subagentStop?: boolean;
    notification?: boolean;
  }) => {
    try {
      await updateNotifications({ feishu: { events } });
      onRefresh();
    } catch (e) {
      alert("更新飞书事件失败：" + String(e));
    }
  };

  return {
    macos,
    dingtalk,
    feishu,
    macosArmed,
    dingtalkArmed,
    feishuArmed,
    macosOpen,
    setMacosOpen,
    dingtalkOpen,
    setDingtalkOpen,
    feishuOpen,
    setFeishuOpen,
    dingSaving,
    dingTesting,
    feishuSaving,
    feishuTesting,
    handleToggleMacos,
    handleChangeMacosEvents,
    handleToggleDingTalk,
    handleChangeDingtalkEvents,
    handleSaveDingTalk,
    handleTestDingTalk,
    handleToggleFeishu,
    handleSaveFeishu,
    handleTestFeishu,
    handleChangeFeishuEvents,
  };
}
