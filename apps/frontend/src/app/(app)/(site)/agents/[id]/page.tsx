import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { Agent } from '@gitroom/frontend/components/agents/agent';
import { AgentChat } from '@gitroom/frontend/components/agents/agent.chat';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_agents', 'oksocial AI 助手'),
    description: '',
  };
}
export default async function Page() {
  return (
    <AgentChat />
  );
}
