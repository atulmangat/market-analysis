import { KnowledgeGraphViewer } from '../components/KnowledgeGraphViewer';

export function KnowledgeGraphPage({ refreshTrigger }: { refreshTrigger?: number }) {
  return <KnowledgeGraphViewer refreshTrigger={refreshTrigger} />;
}
