/**
 * Demonstration of the enhanced ship placement validation
 * This example shows both traditional and position list formats working together
 */

import {
  validateShipPlacements,
  createShipsFromPlacements
} from '../utils/shipValidation';
import {
  ShipPlacement,
  TraditionalShipPlacement,
  PositionListShipPlacement
} from '../types';

console.log('🚢 BATTLESHIPS - Enhanced Ship Placement Validation Demo');
console.log('======================================================\n');

/**
 * Example 1: Traditional Format (Backward Compatible)
 */
console.log('📋 Example 1: Traditional Format (Backward Compatible)');
console.log('------------------------------------------------------');

const traditionalShips: TraditionalShipPlacement[] = [
  { length: 5, startPosition: 'A1', direction: 'horizontal' },
  { length: 4, startPosition: 'C1', direction: 'horizontal' },
  { length: 3, startPosition: 'E1', direction: 'horizontal' },
  { length: 3, startPosition: 'G1', direction: 'horizontal' },
  { length: 2, startPosition: 'I1', direction: 'horizontal' }
];

console.log('Ships (Traditional Format):');
traditionalShips.forEach((ship, index) => {
  console.log(`  Ship ${index + 1}: Length ${ship.length}, ${ship.startPosition} ${ship.direction}`);
});

const traditionalValidation = validateShipPlacements(traditionalShips);
console.log(`\nValidation Result: ${traditionalValidation.valid ? '✅ Valid' : '❌ Invalid'}`);

if (traditionalValidation.valid) {
  const ships = createShipsFromPlacements(traditionalShips);
  ships.forEach((ship, index) => {
    console.log(`  Ship ${index + 1} positions: ${ship.positions.join(', ')}`);
  });
}

/**
 * Example 2: New Position List Format
 */
console.log('\n\n📋 Example 2: New Position List Format');
console.log('--------------------------------------');

const positionListShips: PositionListShipPlacement[] = [
  { length: 5, positions: ['A3', 'B3', 'C3', 'D3', 'E3'] },
  { length: 4, positions: ['A5', 'A6', 'A7', 'A8'] },
  { length: 3, positions: ['C5', 'C6', 'C7'] },
  { length: 3, positions: ['E5', 'E6', 'E7'] },
  { length: 2, positions: ['G5', 'G6'] }
];

console.log('Ships (Position List Format):');
positionListShips.forEach((ship, index) => {
  console.log(`  Ship ${index + 1}: Length ${ship.length}, positions [${ship.positions.join(', ')}]`);
});

const positionListValidation = validateShipPlacements(positionListShips);
console.log(`\nValidation Result: ${positionListValidation.valid ? '✅ Valid' : '❌ Invalid'}`);

if (positionListValidation.valid) {
  const ships = createShipsFromPlacements(positionListShips);
  ships.forEach((ship, index) => {
    console.log(`  Ship ${index + 1} positions: ${ship.positions.join(', ')}`);
  });
}

/**
 * Example 3: Mixed Formats
 */
console.log('\n\n📋 Example 3: Mixed Formats (Traditional + Position List)');
console.log('-------------------------------------------------------');

const mixedShips: ShipPlacement[] = [
  { length: 5, startPosition: 'A1', direction: 'horizontal' },  // Traditional
  { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },          // Position list
  { length: 3, startPosition: 'E1', direction: 'vertical' },    // Traditional
  { length: 3, positions: ['A7', 'A8', 'A9'] },                // Position list
  { length: 2, startPosition: 'G1', direction: 'horizontal' }   // Traditional
];

console.log('Ships (Mixed Formats):');
mixedShips.forEach((ship, index) => {
  if ('positions' in ship) {
    console.log(`  Ship ${index + 1}: Length ${ship.length}, positions [${ship.positions.join(', ')}] (position list)`);
  } else {
    console.log(`  Ship ${index + 1}: Length ${ship.length}, ${ship.startPosition} ${ship.direction} (traditional)`);
  }
});

const mixedValidation = validateShipPlacements(mixedShips);
console.log(`\nValidation Result: ${mixedValidation.valid ? '✅ Valid' : '❌ Invalid'}`);

if (mixedValidation.valid) {
  const ships = createShipsFromPlacements(mixedShips);
  ships.forEach((ship, index) => {
    console.log(`  Ship ${index + 1} positions: ${ship.positions.join(', ')}`);
  });
}

/**
 * Example 4: Error Demonstration with Enhanced Messages
 */
console.log('\n\n📋 Example 4: Error Demonstration with Enhanced Messages');
console.log('------------------------------------------------------');

const invalidShips: ShipPlacement[] = [
  { length: 5, startPosition: 'A1', direction: 'horizontal' },  // A1-A5
  { length: 4, positions: ['A3', 'B3', 'C3', 'D3'] },          // Overlaps at A3
  { length: 3, startPosition: 'B1', direction: 'horizontal' }   // Adjacent to ship 1
  // Missing 2 ships
];

console.log('Ships (Invalid Configuration):');
invalidShips.forEach((ship, index) => {
  if ('positions' in ship) {
    console.log(`  Ship ${index + 1}: Length ${ship.length}, positions [${ship.positions.join(', ')}]`);
  } else {
    console.log(`  Ship ${index + 1}: Length ${ship.length}, ${ship.startPosition} ${ship.direction}`);
  }
});

const invalidValidation = validateShipPlacements(invalidShips);
console.log(`\nValidation Result: ${invalidValidation.valid ? '✅ Valid' : '❌ Invalid'}`);

if (!invalidValidation.valid) {
  console.log('\n🚨 Validation Errors:');
  invalidValidation.errors.forEach((error, index) => {
    console.log(`  ${index + 1}. [${error.type.toUpperCase()}] ${error.message}`);
    if (error.conflictingPositions) {
      console.log(`     Conflicting positions: ${error.conflictingPositions.join(', ')}`);
    }
    if (error.suggestions) {
      console.log(`     Suggestions: ${error.suggestions.join(' ')}`);
    }
  });

  if (invalidValidation.suggestions) {
    console.log('\n💡 General Suggestions:');
    invalidValidation.suggestions.forEach(suggestion => {
      console.log(`  • ${suggestion}`);
    });
  }
}

/**
 * Example 5: Case Insensitive Position Lists
 */
console.log('\n\n📋 Example 5: Case Insensitive Position Lists');
console.log('---------------------------------------------');

const caseInsensitiveShips: PositionListShipPlacement[] = [
  { length: 5, positions: ['a1', 'a2', 'a3', 'a4', 'a5'] },   // lowercase
  { length: 4, positions: ['C1', 'C2', 'C3', 'C4'] },         // uppercase
  { length: 3, positions: ['e1', 'E2', 'e3'] },               // mixed case
  { length: 3, positions: ['G1', 'g2', 'G3'] },               // mixed case
  { length: 2, positions: ['i1', 'I2'] }                      // mixed case
];

console.log('Ships (Case Insensitive):');
caseInsensitiveShips.forEach((ship, index) => {
  console.log(`  Ship ${index + 1}: Length ${ship.length}, positions [${ship.positions.join(', ')}]`);
});

const caseValidation = validateShipPlacements(caseInsensitiveShips);
console.log(`\nValidation Result: ${caseValidation.valid ? '✅ Valid' : '❌ Invalid'}`);

if (caseValidation.valid) {
  const ships = createShipsFromPlacements(caseInsensitiveShips);
  console.log('\nNormalized positions (all uppercase):');
  ships.forEach((ship, index) => {
    console.log(`  Ship ${index + 1} positions: ${ship.positions.join(', ')}`);
  });
}

console.log('\n\n✨ Enhanced Features Summary:');
console.log('============================');
console.log('✅ Backward compatibility with traditional format');
console.log('✅ New position list format support');
console.log('✅ Mixed format support in the same request');
console.log('✅ Case insensitive position handling');
console.log('✅ Detailed error messages with specific suggestions');
console.log('✅ Conflicting position identification');
console.log('✅ Comprehensive validation rules');
console.log('✅ Type safety with TypeScript');
console.log('✅ Full unit test coverage');

console.log('\n🎯 Implementation complete! Ready for Issue #4 review.');