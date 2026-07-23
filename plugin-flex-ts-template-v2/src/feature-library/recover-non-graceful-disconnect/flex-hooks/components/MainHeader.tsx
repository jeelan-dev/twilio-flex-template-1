import React from 'react';
import * as Flex from '@twilio/flex-ui';
import { FlexComponent } from '../../../../types/feature-loader';
import ReconnectDialog from '../../custom-components/ReconnectDialog';

export const componentName = FlexComponent.MainHeader;

export const componentHook = function addReconnectDialog(flex: typeof Flex, _manager: Flex.Manager) {
  flex.MainHeader.Content.add(<ReconnectDialog key="reconnect-dialog" />, { sortOrder: 100 });
};
