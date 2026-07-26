package walletrpc

import (
	"context"
	"fmt"
	"sync"
)

// Mock implements Wallet in memory for tests and local runs.
type Mock struct {
	mu        sync.Mutex
	next      uint32
	transfers []Transfer
}

func NewMock() *Mock {
	return &Mock{next: 1}
}

func (m *Mock) CreateSubaddress(_ context.Context, _ string) (string, uint32, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	index := m.next
	m.next++
	return mockAddress(index), index, nil
}

// Pay simulates an incoming transfer to a subaddress.
func (m *Mock) Pay(index uint32, amountAtomic, confirmations uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.transfers = append(m.transfers, Transfer{
		TxID:          fmt.Sprintf("mocktx%d", len(m.transfers)+1),
		Address:       mockAddress(index),
		SubaddrIndex:  index,
		AmountAtomic:  amountAtomic,
		Confirmations: confirmations,
	})
}

func (m *Mock) IncomingTransfers(context.Context) ([]Transfer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Transfer, len(m.transfers))
	copy(out, m.transfers)
	return out, nil
}

func mockAddress(index uint32) string {
	return fmt.Sprintf("SCmock%08d", index)
}
