import {
  validateShipPlacements,
  createShipsFromPlacements
} from '../shipValidation';
import {
  ShipPlacement,
  TraditionalShipPlacement,
  PositionListShipPlacement,
  ValidationResult
} from '../../types';

describe('Ship Placement Validation', () => {
  describe('validateShipPlacements', () => {
    describe('Traditional Format', () => {
      it('should validate correct ship placements', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 5, startPosition: 'A1', direction: 'horizontal' },
          { length: 4, startPosition: 'C1', direction: 'horizontal' },
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, startPosition: 'G1', direction: 'horizontal' },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should detect wrong number of ships', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 5, startPosition: 'A1', direction: 'horizontal' },
          { length: 4, startPosition: 'C1', direction: 'horizontal' }
          // Missing 3 ships
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        const shipCountError = result.errors.find(e => e.type === 'ship_count');
        expect(shipCountError).toBeDefined();
        expect(shipCountError!.message).toContain('Must place exactly 5 ships');
        expect(shipCountError!.suggestions).toContain('Add 3 more ships to complete your fleet.');
      });

      it('should detect wrong ship lengths', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 6, startPosition: 'A1', direction: 'horizontal' }, // Wrong length
          { length: 4, startPosition: 'C1', direction: 'horizontal' },
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, startPosition: 'G1', direction: 'horizontal' },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_length');
        expect(result.errors[0]!.message).toContain('Ship lengths must be: 5, 4, 3, 3, 2');
        expect(result.errors[0]!.message).toContain('Missing ships of length: 5');
        expect(result.errors[0]!.message).toContain('Invalid ship lengths: 6');
      });

      it('should detect ships going out of bounds', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 5, startPosition: 'A7', direction: 'horizontal' }, // Goes to A11 (out of bounds)
          { length: 4, startPosition: 'C1', direction: 'horizontal' },
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, startPosition: 'G1', direction: 'horizontal' },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_bounds');
        expect(result.errors[0]!.message).toContain('Ship 1: Ship extends beyond board boundaries');
        expect(result.errors[0]!.suggestions).toContain('Try moving ship 1 to a different position.');
      });

      it('should detect overlapping ships', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 5, startPosition: 'A1', direction: 'horizontal' }, // A1-A5
          { length: 4, startPosition: 'A3', direction: 'vertical' },   // A3-D3 (overlaps at A3)
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, startPosition: 'G1', direction: 'horizontal' },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        const overlapError = result.errors.find(e => e.type === 'ship_overlap');
        expect(overlapError).toBeDefined();
        expect(overlapError!.message).toContain('Ship 1 and Ship 2 overlap at position A3');
        expect(overlapError!.conflictingPositions).toContain('A3');
      });

      it('should detect adjacent ships', () => {
        const ships: TraditionalShipPlacement[] = [
          { length: 5, startPosition: 'A1', direction: 'horizontal' }, // A1-A5
          { length: 4, startPosition: 'B1', direction: 'horizontal' }, // B1-B4 (adjacent to first ship)
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, startPosition: 'G1', direction: 'horizontal' },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_adjacent');
        expect(result.errors[0]!.message).toContain('Ship 1 and Ship 2 are touching');
        expect(result.errors[0]!.suggestions).toContain('Move Ship 1 or Ship 2 to create space between them.');
      });
    });

    describe('Position List Format', () => {
      it('should validate correct ship placements with position lists', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'A3', 'A4', 'A5'] },
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate vertical ship placements', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'B1', 'C1', 'D1', 'E1'] },
          { length: 4, positions: ['A3', 'B3', 'C3', 'D3'] },
          { length: 3, positions: ['A5', 'B5', 'C5'] },
          { length: 3, positions: ['A7', 'B7', 'C7'] },
          { length: 2, positions: ['A9', 'B9'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should detect position count mismatch', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'A3'] }, // Only 3 positions for length 5
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_format');
        expect(result.errors[0]!.message).toContain('Ship 1: Position count (3) doesn\'t match ship length (5)');
        expect(result.errors[0]!.suggestions).toContain('Provide exactly 5 positions for a ship of length 5.');
      });

      it('should detect invalid position format', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'Z99', 'A4', 'A5'] }, // Z99 is invalid
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('position_format');
        expect(result.errors[0]!.message).toContain('Ship 1: Invalid position "Z99" at index 3');
        expect(result.errors[0]!.suggestions).toContain('Use valid coordinates like "A1", "B5", "J10".');
      });

      it('should detect non-continuous positions', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'A4', 'A5', 'A6'] }, // Gap at A3
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_format');
        expect(result.errors[0]!.message).toContain('Ship 1: Positions must be continuous with no gaps');
        expect(result.errors[0]!.suggestions).toContain('Ensure positions are adjacent to each other.');
      });

      it('should detect non-linear positions', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'B2', 'B3', 'B4'] }, // Not a straight line
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('ship_format');
        expect(result.errors[0]!.message).toContain('Ship 1: Positions must form a straight line');
        expect(result.errors[0]!.suggestions).toContain('Ships must be placed in a straight line.');
      });

      it('should detect empty positions', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', '', 'A4', 'A5'] }, // Empty position
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.type).toBe('position_format');
        expect(result.errors[0]!.message).toContain('Ship 1: Position 3 is empty or undefined');
        expect(result.errors[0]!.suggestions).toContain('All positions must be valid coordinates like "A1", "B5", etc.');
      });
    });

    describe('Mixed Format Support', () => {
      it('should support mixing traditional and position list formats', () => {
        const ships: ShipPlacement[] = [
          { length: 5, startPosition: 'A1', direction: 'horizontal' },
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, startPosition: 'E1', direction: 'horizontal' },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, startPosition: 'I1', direction: 'horizontal' }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle case insensitive positions', () => {
        const ships: PositionListShipPlacement[] = [
          { length: 5, positions: ['a1', 'a2', 'a3', 'a4', 'a5'] }, // lowercase
          { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Error Message Quality', () => {
      it('should provide helpful suggestions for all error types', () => {
        const ships: ShipPlacement[] = [
          { length: 6, startPosition: 'A1', direction: 'horizontal' }, // Wrong length
          { length: 4, startPosition: 'A2', direction: 'horizontal' }  // Adjacent
          // Missing ships
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions).toContain('Try placing ships with at least one empty space between them.');
        expect(result.suggestions).toContain('Ensure all ships fit within the 10x10 board (A1 to J10).');

        // Check individual error suggestions
        const shipLengthError = result.errors.find(e => e.type === 'ship_length');
        expect(shipLengthError?.suggestions).toBeDefined();
        expect(shipLengthError?.suggestions?.length).toBeGreaterThan(0);
      });

      it('should include conflicting positions in overlap errors', () => {
        const ships: ShipPlacement[] = [
          { length: 5, positions: ['A1', 'A2', 'A3', 'A4', 'A5'] },
          { length: 4, positions: ['A3', 'B3', 'C3', 'D3'] }, // Overlaps at A3
          { length: 3, positions: ['E1', 'E2', 'E3'] },
          { length: 3, positions: ['G1', 'G2', 'G3'] },
          { length: 2, positions: ['I1', 'I2'] }
        ];

        const result = validateShipPlacements(ships);

        expect(result.valid).toBe(false);
        const overlapError = result.errors.find(e => e.type === 'ship_overlap');
        expect(overlapError?.conflictingPositions).toContain('A3');
        expect(overlapError?.suggestions).toContain('Move one of the overlapping ships away from A3.');
      });
    });
  });

  describe('createShipsFromPlacements', () => {
    it('should create ships from traditional format', () => {
      const placements: TraditionalShipPlacement[] = [
        { length: 5, startPosition: 'A1', direction: 'horizontal' },
        { length: 4, startPosition: 'C1', direction: 'vertical' }
      ];

      const ships = createShipsFromPlacements(placements);

      expect(ships).toHaveLength(2);
      expect(ships[0]).toEqual({
        id: 'ship-1',
        length: 5,
        positions: ['A1', 'A2', 'A3', 'A4', 'A5'],
        hits: 0,
        sunk: false
      });
      expect(ships[1]).toEqual({
        id: 'ship-2',
        length: 4,
        positions: ['C1', 'D1', 'E1', 'F1'],
        hits: 0,
        sunk: false
      });
    });

    it('should create ships from position list format', () => {
      const placements: PositionListShipPlacement[] = [
        { length: 3, positions: ['A1', 'A2', 'A3'] },
        { length: 2, positions: ['B5', 'C5'] }
      ];

      const ships = createShipsFromPlacements(placements);

      expect(ships).toHaveLength(2);
      expect(ships[0]).toEqual({
        id: 'ship-1',
        length: 3,
        positions: ['A1', 'A2', 'A3'],
        hits: 0,
        sunk: false
      });
      expect(ships[1]).toEqual({
        id: 'ship-2',
        length: 2,
        positions: ['B5', 'C5'],
        hits: 0,
        sunk: false
      });
    });

    it('should handle mixed formats', () => {
      const placements: ShipPlacement[] = [
        { length: 3, startPosition: 'A1', direction: 'horizontal' },
        { length: 2, positions: ['B5', 'C5'] }
      ];

      const ships = createShipsFromPlacements(placements);

      expect(ships).toHaveLength(2);
      expect(ships[0]!.positions).toEqual(['A1', 'A2', 'A3']);
      expect(ships[1]!.positions).toEqual(['B5', 'C5']);
    });

    it('should normalize position case in position list format', () => {
      const placements: PositionListShipPlacement[] = [
        { length: 3, positions: ['a1', 'a2', 'a3'] } // lowercase
      ];

      const ships = createShipsFromPlacements(placements);

      expect(ships[0]!.positions).toEqual(['A1', 'A2', 'A3']); // uppercase
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty ship array', () => {
      const result = validateShipPlacements([]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const shipCountError = result.errors.find(e => e.type === 'ship_count');
      expect(shipCountError).toBeDefined();
    });

    it('should handle single position ships', () => {
      const ships: PositionListShipPlacement[] = [
        { length: 1, positions: ['A1'] }
      ];

      // This should fail because battleships don't have length 1
      const result = validateShipPlacements(ships);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'ship_length')).toBe(true);
    });

    it('should handle maximum board positions', () => {
      const ships: PositionListShipPlacement[] = [
        { length: 5, positions: ['J6', 'J7', 'J8', 'J9', 'J10'] }, // At the edge
        { length: 4, positions: ['A1', 'A2', 'A3', 'A4'] },
        { length: 3, positions: ['C1', 'C2', 'C3'] },
        { length: 3, positions: ['E1', 'E2', 'E3'] },
        { length: 2, positions: ['G1', 'G2'] }
      ];

      const result = validateShipPlacements(ships);
      expect(result.valid).toBe(true);
    });
  });
});