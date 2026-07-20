import React from 'react';
import { connect } from 'react-redux';
import { Actions, withTheme } from '@twilio/flex-ui';
import { Dialog, DialogContent } from '@material-ui/core';
import styled from '@emotion/styled';

const DialogStyles = styled('div')`
  .dialog-text {
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    padding: 8px 0;
  }
  .dialog-text-detail {
    font-size: 13px;
    color: #666;
    text-align: center;
    padding: 4px 0 8px;
  }
`;

interface Props {
  isOpen?: boolean;
  message?: string;
  messageDetail?: string;
}

class ReconnectDialog extends React.Component<Props> {
  handleClose = (_event: unknown, reason: string) => {
    if (reason !== 'backdropClick') {
      Actions.invokeAction('SetComponentState', { name: 'ReconnectDialog', state: { isOpen: false } });
    }
  };

  render() {
    return (
      <Dialog open={this.props.isOpen ?? false} onClose={this.handleClose} disableEscapeKeyDown>
        <DialogStyles>
          <DialogContent>
            <div className="dialog-text">{this.props.message}</div>
            {this.props.messageDetail && <div className="dialog-text-detail">{this.props.messageDetail}</div>}
          </DialogContent>
        </DialogStyles>
      </Dialog>
    );
  }
}

const mapStateToProps = (state: any) => {
  const reconnectState = state?.flex?.view?.componentViewStates?.ReconnectDialog;
  return {
    isOpen: reconnectState?.isOpen,
    message: reconnectState?.message,
    messageDetail: reconnectState?.messageDetail,
  };
};

export default connect(mapStateToProps)(withTheme(ReconnectDialog));
