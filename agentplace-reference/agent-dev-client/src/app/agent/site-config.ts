import { defineMessages } from 'react-intl';
import './theme.css';
import type { AgentLogo } from '@/app/lib/stage/StageHeader.tsx';
import type { MessageDescriptor } from 'react-intl';

const siteMessages = defineMessages({
  askPlaceholder: {
    id: 'composer.businessPrompt',
    defaultMessage: 'What plumbing help do you need…',
    description: 'Invitation shown inside the empty composer.',
  },
});

export interface SiteConfig {
  brandName: string;
  /** Optional logo in a scrolling circle. Clicking sends Start over within this conversation. */
  logo?: AgentLogo;
  /** The assistant's appearance. 'auto' follows the visitor's OS. */
  appearance: 'light' | 'dark' | 'auto';
  /** Omnibox placeholder override. */
  placeholder?: MessageDescriptor;
}

export const SITE_CONFIG: SiteConfig = {
  brandName: 'Jasper Plumbing House',
  appearance: 'auto',
  placeholder: siteMessages.askPlaceholder,
};
