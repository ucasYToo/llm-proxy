import { useMemo, useState } from 'react';
import type { Config, TimelineEntry } from '../../lib/api';
import { updateProjectRemarkApi } from '../../lib/api';
import { LogDetailPanel } from '../LogDetailPanel';
import { HookDetailPanel } from '../HookDetailPanel';
import SessionAnalyticsPanel from '../SessionAnalyticsPanel';
import type { SessionGroup } from './types';
import { cwdFromEntry, UNKNOWN_GROUP_KEY } from './utils';
import { useDashboardData } from './useDashboardData';
import { useNotifications } from './useNotifications';
import SessionList from './SessionList';
import EventStream from './EventStream';
import DingTalkPanel from './DingTalkPanel';
import FeishuPanel from './FeishuPanel';
import FeishuRemotePanel from './FeishuRemotePanel';
import MacosNotifyPanel from './MacosNotifyPanel';
import ProjectCard from './ProjectCard';
import styles from './index.module.css';
import { isShowFeishu } from '../../constant';

interface Props {
  config: Config;
  onRefresh: () => void;
}

const DashboardTab = ({ config, onRefresh }: Props) => {
  const data = useDashboardData();
  const [feishuRemoteOpen, setFeishuRemoteOpen] = useState(false);
  const notify = useNotifications({
    notifications: config.notifications ?? {},
    onRefresh,
  });

  const eventsByProject = useMemo(() => {
    const sessionKeyMap = new Map<string, string>();
    for (const s of data.sessions) {
      if (s.sessionId) {
        sessionKeyMap.set(s.sessionId, s.cwd ?? UNKNOWN_GROUP_KEY);
      }
    }
    const map = new Map<string, TimelineEntry[]>();
    for (const entry of data.globalTimeline) {
      let key: string;
      if (entry.kind === 'hook') {
        const bySession = entry.hook.sessionId
          ? sessionKeyMap.get(entry.hook.sessionId)
          : undefined;
        key = bySession ?? cwdFromEntry(entry.hook) ?? UNKNOWN_GROUP_KEY;
      } else {
        const bySession = entry.log.sessionId
          ? sessionKeyMap.get(entry.log.sessionId)
          : undefined;
        key = bySession ?? UNKNOWN_GROUP_KEY;
      }
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return map;
  }, [data.globalTimeline, data.sessions]);

  const orphanEvents = useMemo<TimelineEntry[]>(() => {
    const sessionKeys = new Set(data.sessionGroups.map((g: SessionGroup) => g.key));
    const result: TimelineEntry[] = [];
    for (const [key, entries] of eventsByProject) {
      if (!sessionKeys.has(key)) result.push(...entries);
    }
    return result.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [eventsByProject, data.sessionGroups]);

  return (
    <div className={styles.dashboard}>
      <div className={styles.toolbar}>
        <div className={styles.statusGroup}>
          <span
            className={`${styles.statusDot}${data.sseStatus === 'open' ? ` ${styles.statusDotOpen}` : data.sseStatus === 'closed' ? ` ${styles.statusDotClosed}` : ''}`}
          />
          <span className={styles.statusLabel}>
            {data.sseStatus === 'open'
              ? '实时连接'
              : data.sseStatus === 'closed'
                ? '已断开'
                : '连接中…'}
          </span>
        </div>

        <div className={styles.toggleGroup}>
          <span className={styles.toggleGroupLabel}>通知：</span>
          <label
            className={styles.toggleChip}
            title={
              !!notify.macos.enabled && !notify.macosArmed
                ? '已启用但未勾选任何事件，点配置进去选'
                : 'macOS 系统通知（含声音）'
            }
          >
            <input
              type="checkbox"
              checked={!!notify.macos.enabled}
              onChange={(e) => void notify.handleToggleMacos(e.target.checked)}
            />
            macOS
            {!!notify.macos.enabled && !notify.macosArmed && (
              <span className={styles.warnDot} title="未勾选事件">!</span>
            )}
          </label>
          <button type="button" className="btnGhost btnSm" onClick={() => notify.setMacosOpen((v) => !v)}>
            {notify.macosOpen ? '收起' : '配置'}
          </button>

          <label
            className={styles.toggleChip}
            title={
              !!notify.dingtalk.enabled && !notify.dingtalkArmed
                ? '已启用但缺少事件勾选 / token / secret，点配置补全'
                : '钉钉群机器人'
            }
          >
            <input
              type="checkbox"
              checked={!!notify.dingtalk.enabled}
              onChange={(e) => void notify.handleToggleDingTalk(e.target.checked)}
            />
            钉钉
            {!!notify.dingtalk.enabled && !notify.dingtalkArmed && (
              <span className={styles.warnDot} title="未完成配置">!</span>
            )}
          </label>
          <button type="button" className="btnGhost btnSm" onClick={() => notify.setDingtalkOpen((v) => !v)}>
            {notify.dingtalkOpen ? '收起' : '配置'}
          </button>
          {isShowFeishu && (
            <>
              <label
                className={styles.toggleChip}
                title={
                  !!notify.feishu.enabled && !notify.feishuArmed
                    ? '已启用但缺少事件勾选 / webhook URL / secret，点配置补全'
                    : '飞书群机器人'
                }
              >
                <input
                  type="checkbox"
                  checked={!!notify.feishu.enabled}
                  onChange={(e) => void notify.handleToggleFeishu(e.target.checked)}
                />
                飞书
                {!!notify.feishu.enabled && !notify.feishuArmed && (
                  <span className={styles.warnDot} title="未完成配置">!</span>
                )}
              </label>
              <button type="button" className="btnGhost btnSm" onClick={() => notify.setFeishuOpen((v) => !v)}>
                {notify.feishuOpen ? '收起' : '配置'}
              </button>
            </>
          )}
        </div>

        {data.caffeinate.supported && (
          <div className={styles.toggleGroup}>
            <label
              className={styles.toggleChip}
              title="启动 caffeinate -s -i：锁屏 / 合盖时也保持系统不睡眠"
            >
              <input
                type="checkbox"
                checked={data.caffeinate.active}
                onChange={(e) => void data.handleToggleCaffeinate(e.target.checked)}
              />
              防止睡眠
            </label>
          </div>
        )}

        {isShowFeishu && (
          <div className={styles.toggleGroup}>
            <span className={styles.toggleGroupLabel}>远控：</span>
            <label
              className={styles.toggleChip}
              title={
                config.feishuRemote?.enabled
                  ? '飞书自建应用远程控制已启用'
                  : '飞书自建应用远程控制'
              }
            >
              <input type="checkbox" checked={!!config.feishuRemote?.enabled} readOnly />
              飞书
              {!!config.feishuRemote?.enabled && (
                <span className={styles.statusMiniDot} title="远控已启用" />
              )}
            </label>
            <button type="button" className="btnGhost btnSm" onClick={() => setFeishuRemoteOpen((v) => !v)}>
              {feishuRemoteOpen ? '收起' : '配置'}
            </button>
          </div>
        )}

        <div className={styles.toolbarSpacer} />

        {data.selectedSession && (
          <>
            {!data.analyticsSessionId && (
              <button className="btnGhost btnSm" onClick={() => data.setAnalyticsSessionId(data.selectedSession)}>
                📊 会话分析
              </button>
            )}
            {data.analyticsSessionId && (
              <button className="btnGhost btnSm" onClick={() => data.setAnalyticsSessionId(null)}>
                ← 返回事件流
              </button>
            )}
            <button
              className="btnGhost btnSm"
              onClick={() => {
                data.setSelectedSession(null);
                data.setAnalyticsSessionId(null);
              }}
            >
              ← 返回项目列表
            </button>
          </>
        )}

        <button className="btnGhost btnSm" onClick={data.handleClear}>
          清空记录
        </button>
      </div>

      {notify.macosOpen && (
        <MacosNotifyPanel
          events={notify.macos.events}
          onChange={(next) => void notify.handleChangeMacosEvents(next)}
        />
      )}

      {notify.dingtalkOpen && (
        <DingTalkPanel
          config={notify.dingtalk}
          saving={notify.dingSaving}
          testing={notify.dingTesting}
          onSave={notify.handleSaveDingTalk}
          onTest={notify.handleTestDingTalk}
          onChangeEvents={(next) => void notify.handleChangeDingtalkEvents(next)}
        />
      )}

      {isShowFeishu && notify.feishuOpen && (
        <FeishuPanel
          config={notify.feishu}
          saving={notify.feishuSaving}
          testing={notify.feishuTesting}
          onSave={notify.handleSaveFeishu}
          onTest={notify.handleTestFeishu}
          onChangeEvents={(next) => void notify.handleChangeFeishuEvents(next)}
        />
      )}

      {isShowFeishu && feishuRemoteOpen && (
        <FeishuRemotePanel
          initialConfig={config.feishuRemote}
          serverPort={config.serverPort}
        />
      )}

      {!data.selectedSession ? (
        <div className={styles.projectGrid}>
          {data.sessionGroups.length === 0 && orphanEvents.length === 0 ? (
            <div className={styles.emptyHint}>
              暂无活跃项目。在终端运行{' '}
              <code>claude-proxy hook install</code> 把 hook 注册到 Claude Code。
            </div>
          ) : (
            <>
              {data.sessionGroups.map((group) => (
                <ProjectCard
                  key={group.key}
                  folder={group.folder}
                  cwd={group.cwd}
                  sessions={group.sessions}
                  events={eventsByProject.get(group.key) ?? []}
                  selectedDetail={data.selectedDetail}
                  onSelectDetail={data.setSelectedDetail}
                  onEnterProject={() => {
                    const latest = group.sessions[0];
                    if (latest) data.setSelectedSession(latest.sessionId);
                  }}
                />
              ))}
              {orphanEvents.length > 0 && (
                <ProjectCard
                  key="__orphan__"
                  folder="其他事件"
                  cwd={null}
                  sessions={[]}
                  events={orphanEvents}
                  selectedDetail={data.selectedDetail}
                  onSelectDetail={data.setSelectedDetail}
                  onEnterProject={() => {}}
                />
              )}
            </>
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <SessionList
            sessionGroups={data.sessionGroups}
            sessions={data.sessions}
            selectedSession={data.selectedSession}
            collapsedGroups={data.collapsedGroups}
            eventCount={data.events.length + data.globalLogs.length}
            onSelectSession={(sid) => {
              data.setSelectedSession(sid);
              data.setAnalyticsSessionId(null);
            }}
            onToggleGroup={data.toggleGroup}
            onSaveRemark={async (cwd, remark) => {
              await updateProjectRemarkApi(cwd, remark);
              await data.refreshSessions();
            }}
          />

          {data.analyticsSessionId ? (
            <SessionAnalyticsPanel
              sessionId={data.analyticsSessionId}
              onClose={() => data.setAnalyticsSessionId(null)}
            />
          ) : (
            <EventStream
              selectedSession={data.selectedSession}
              sessions={data.sessions}
              timeline={data.visibleTimeline}
              filterPreset={data.filter.filterPreset}
              enabledTypes={data.filter.enabledTypes}
              filterSearch={data.filter.filterSearch}
              agentRoleFilter={data.filter.agentRoleFilter}
              agentOptions={data.agentOptions}
              selectedAgentId={data.filter.selectedAgentId}
              selectedDetail={data.selectedDetail}
              targetCount={config.targets.length}
              onSelectDetail={data.setSelectedDetail}
              onSetPreset={data.filter.setPreset}
              onToggleType={data.filter.toggleType}
              onSearchChange={data.filter.setFilterSearch}
              onAgentRoleChange={data.filter.setAgentRoleFilter}
              onSelectAgent={data.filter.setSelectedAgentId}
            />
          )}
        </div>
      )}

      <LogDetailPanel
        log={data.selectedDetail?.kind === 'log' ? data.selectedDetail.entry : null}
        onClose={() => data.setSelectedDetail(null)}
      />
      <HookDetailPanel
        entry={data.selectedDetail?.kind === 'hook' ? data.selectedDetail.entry : null}
        onClose={() => data.setSelectedDetail(null)}
      />
    </div>
  );
};

export default DashboardTab;
