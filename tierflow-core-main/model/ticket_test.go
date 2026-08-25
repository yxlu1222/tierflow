/*
Copyright (C) 2023-2026 TierFlow
*/
package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTicketMessageMigrationIncludesInternalNoteCompatibilityColumn(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Ticket{}, &TicketMessage{}))
	require.True(t, DB.Migrator().HasColumn(&TicketMessage{}, "is_internal_note"))
}
