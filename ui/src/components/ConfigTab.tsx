import { useState } from "react";
import type { Target } from "../lib/api";
import {
  addTarget,
  updateTarget,
  deleteTarget,
  setActiveTarget,
} from "../lib/api";
import { TargetForm } from "./TargetForm";

interface ConfigTabProps {
  targets: Target[];
  activeTarget: string;
  onRefresh: () => void;
}

export function ConfigTab({
  targets,
  activeTarget,
  onRefresh,
}: ConfigTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);

  const handleAdd = async (data: {
    name: string;
    url: string;
    headers: string;
    bodyParams: string;
  }) => {
    try {
      await addTarget({
        name: data.name,
        url: data.url,
        headers: JSON.parse(data.headers),
        bodyParams: JSON.parse(data.bodyParams),
      });
      setShowForm(false);
      onRefresh();
    } catch (err) {
      alert("添加失败: " + (err as Error).message);
    }
  };

  const handleEdit = async (data: {
    name: string;
    url: string;
    headers: string;
    bodyParams: string;
  }) => {
    if (!editingTarget) return;
    try {
      await updateTarget({
        ...editingTarget,
        name: data.name,
        url: data.url,
        headers: JSON.parse(data.headers),
        bodyParams: JSON.parse(data.bodyParams),
      });
      setEditingTarget(null);
      onRefresh();
    } catch (err) {
      alert("更新失败: " + (err as Error).message);
    }
  };

  const handleDelete = async (targetId: string) => {
    if (!confirm("确定要删除此目标吗？")) return;
    try {
      await deleteTarget(targetId);
      onRefresh();
    } catch (err) {
      alert("删除失败: " + (err as Error).message);
    }
  };

  const handleSetActive = async (targetId: string) => {
    try {
      await setActiveTarget(targetId);
      onRefresh();
    } catch (err) {
      alert("设置活动目标失败: " + (err as Error).message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <button onClick={() => setShowForm(true)}>添加目标</button>
      </div>

      {showForm && (
        <div>
          <h3>添加目标</h3>
          <TargetForm
            onSubmit={handleAdd}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {editingTarget && (
        <div>
          <h3>编辑目标</h3>
          <TargetForm
            onSubmit={handleEdit}
            onCancel={() => setEditingTarget(null)}
            initialData={{
              name: editingTarget.name,
              url: editingTarget.url,
              headers: JSON.stringify(editingTarget.headers, null, 2),
              bodyParams: JSON.stringify(editingTarget.bodyParams, null, 2),
            }}
          />
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>URL</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => (
            <tr key={target.id}>
              <td>{target.name}</td>
              <td>{target.url}</td>
              <td>{target.id === activeTarget ? "活动" : ""}</td>
              <td>
                <button onClick={() => handleSetActive(target.id)}>
                  设为活动
                </button>
                <button onClick={() => setEditingTarget(target)}>编辑</button>
                <button onClick={() => handleDelete(target.id)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
