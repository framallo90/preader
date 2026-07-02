import { Component, PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { runtimeStateRepository } from '../storage/runtimeStateRepository';

type State = {
  hasError: boolean;
  message: string;
  resetKey: number;
};

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = {
    hasError: false,
    message: '',
    resetKey: 0,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || 'Se produjo un error inesperado.',
    };
  }

  override componentDidCatch() {
    void runtimeStateRepository.clearReaderLoadGuard();
  }

  private handleReset = () => {
    void runtimeStateRepository.clearReaderLoadGuard();
    this.setState((current) => ({
      hasError: false,
      message: '',
      resetKey: current.resetKey + 1,
    }));
  };

  override render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>La app se recupero de un cierre inesperado</Text>
          <Text style={styles.subtitle}>
            {this.state.message || 'Se limpio el estado temporal para evitar un nuevo cierre en bucle.'}
          </Text>
          <Pressable style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonLabel}>Reintentar</Text>
          </Pressable>
        </View>
      );
    }

    return <View style={styles.flex}>{this.props.children}</View>;
  }
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#f7f4ee',
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#253038',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5a6870',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6b9f98',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
