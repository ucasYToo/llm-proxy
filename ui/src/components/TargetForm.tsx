import { useState } from "react";

interface TargetFormProps {
  onSubmit: (data: {
    name: string;
    url: string;
    headers: string;
    bodyParams: string;
  }) => void;
  onCancel: () => void;
  initialData?: {
    name: string;
    url: string;
    headers: string;
    bodyParams: string;
  };
}

export function TargetForm({
  onSubmit,
  onCancel,
  initialData,
}: TargetFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [url, setUrl] = useState(initialData?.url ?? "");
  const [headers, setHeaders] = useState(initialData?.headers ?? "{}");
  const [bodyParams, setBodyParams] = useState(initialData?.bodyParams ?? "{}");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, url, headers, bodyParams });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>
          名称:
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
      </div>
      <div>
        <label>
          URL:
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
      </div>
      <div>
        <label>
          Headers (JSON):
          <textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            rows={4}
          />
        </label>
      </div>
      <div>
        <label>
          Body Params (JSON):
          <textarea
            value={bodyParams}
            onChange={(e) => setBodyParams(e.target.value)}
            rows={4}
          />
        </label>
      </div>
      <div>
        <button type="submit">保存</button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
