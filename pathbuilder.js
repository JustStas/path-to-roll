// Function to update the CSS based on tinting preference
function updateTintingCSS(blockTinting) {
    // Remove any existing style element
    const existingStyle = document.getElementById('tinting-style');
    if (existingStyle) {
        existingStyle.remove();
    }

    // Create new style element
    const style = document.createElement('style');
    style.id = 'tinting-style';

    // Only add the CSS if blocking is enabled
    if (blockTinting) {
        style.textContent = `
            body > div.dice-tray,
            #dice-backdrop {
                display: none !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;
    }
    document.head.appendChild(style);
}

// Initialize tinting preference from storage
chrome.storage.sync.get(['blockTinting'], function(result) {
    // Default to true if not set
    updateTintingCSS(result.blockTinting !== false);
});

// Listen for preference updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_TINTING') {
        updateTintingCSS(message.blockTinting);
    }
});

// Listen for clicks anywhere on the document.
document.addEventListener('click', function(e) {
    // Check if the click occurred inside a skill container.
    const skillElement = e.target.closest('.section-skill');
    if (!skillElement) return; // Not clicking a skill element.

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            // Only prevent default and stop propagation if blocking is enabled
            e.preventDefault();
            e.stopPropagation();
        }

        // Grab the modifier element inside the clicked skill.
        const modifierElement = skillElement.querySelector('.section-skill-total');
        if (!modifierElement) {
          console.warn("Modifier element not found in the clicked skill.");
          return;
        }

        // Get the skill name from the skill element
        const skillNameElement = skillElement.querySelector('.section-skill-name');
        if (!skillNameElement) {
          console.warn("Skill name element not found in the clicked skill.");
          return;
        }

        // Extract and clean up the modifier text.
        let modifier = modifierElement.textContent.trim();
        // Ensure the modifier has a + or - sign.
        if (!modifier.startsWith('+') && !modifier.startsWith('-')) {
          modifier = `+${modifier}`;
        }

        // Get the character name from the specific path
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';
        console.log('Found character name:', charName);
        const skillName = skillNameElement.textContent.trim();

        // Initiative is a special case: if a matching token exists in Roll20,
        // we'll also try to add the rolled result to the initiative tracker.
        const isInitiativeRoll = skillName.toLowerCase() === 'initiative';

        let rollString;
        let initiativePayload;

        if (isInitiativeRoll) {
            // Roll once here so the chat output and initiative tracker use the same value.
            const parsedModifier = Number.parseInt(modifier, 10) || 0;
            const d20 = Math.floor(Math.random() * 20) + 1;
            const total = d20 + parsedModifier;

            rollString = `&{template:default} {{name=${charName} - ${skillName}}} {{roll=[[${total}]]}} {{modifier=${modifier}}} {{formula=1d20${modifier}}} {{d20=${d20}}}`;
            initiativePayload = {
                enabled: true,
                characterName: charName,
                modifier: modifier,
                d20,
                total
            };
        } else {
            // Default roll behavior for non-initiative skill checks.
            rollString = `&{template:default} {{name=${charName} - ${skillName}}} {{roll=[[1d20${modifier}]]}} {{modifier=${modifier}}}`;
        }

        // Handle roll string copying and sending
        handleRollString(
            rollString,
            `${skillName} check`,
            e.clientX,
            e.clientY,
            initiativePayload ? { initiative: initiativePayload } : undefined
        );
    });
});

// Listen for clicks on attack elements
document.addEventListener('click', function(e) {
    // Check if we clicked on or inside the attack tooltip (with d20 icon)
    const hitElement = e.target.closest('.tooltip');
    if (!hitElement || !hitElement.querySelector('img.icon-dice')) return;

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            // Only prevent default and stop propagation if blocking is enabled
            e.preventDefault();
            e.stopPropagation();
        }

        // Get the base attack bonus (text node after Hit:)
        const hitDiv = hitElement.querySelector('.weapon-hit');
        if (!hitDiv) {
            console.warn("Hit div not found.");
            return;
        }

        let attackBonus = '';
        const hitSpan = hitDiv.querySelector('.weapon-span');
        if (hitSpan) {
            const nextNode = hitSpan.nextSibling;
            if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
                attackBonus = nextNode.textContent.trim();
            }
        }

        if (!attackBonus) {
            console.warn("Attack bonus not found.");
            return;
        }

        // Ensure the bonus has a + or - sign
        if (!attackBonus.startsWith('+') && !attackBonus.startsWith('-')) {
            attackBonus = `+${attackBonus}`;
        }

        // Get the weapon name from the parent container
        const weaponNameElement = hitElement.parentElement.querySelector('.weapon-name');
        const weaponName = weaponNameElement ? weaponNameElement.textContent.trim() : 'Attack';

        // Get proficiency level from the icon
        const profIcon = hitElement.parentElement.querySelector('img[src*="icon_prof_"]');
        let profLevel = '';
        if (profIcon) {
            if (profIcon.src.includes('trained')) profLevel = 'Trained';
            else if (profIcon.src.includes('expert')) profLevel = 'Expert';
            else if (profIcon.src.includes('master')) profLevel = 'Master';
            else if (profIcon.src.includes('legendary')) profLevel = 'Legendary';
        }

        // Get weapon traits
        const weaponContainer = hitElement.closest('.weapon-container');
        const traitsDiv = weaponContainer ? weaponContainer.querySelector('.weapon-traits') : null;
        const traits = [];
        if (traitsDiv) {
            traitsDiv.querySelectorAll('.trait').forEach(trait => {
                traits.push(trait.textContent.trim());
            });
        }
        const traitsText = traits.length > 0 ? traits.join(', ') : '';

        // Get the character name
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';

        // Create the roll template string for attack
        const rollString = `&{template:default} {{name=${charName} - ${weaponName} Attack}} {{attack=[[1d20${attackBonus}]]}}${profLevel ? ` {{proficiency=${profLevel}}}` : ''}${traitsText ? ` {{traits=${traitsText}}}` : ''}`;

        // Handle roll string copying and sending
        handleRollString(rollString, 'Attack roll', e.clientX, e.clientY);
    });
});

// Function to parse damage elements from the full damage text
function parseDamageElements(fullText) {
    // Remove the "Critical" section if present
    const mainText = fullText.split('Critical')[0].trim();

    // Extract damage elements using regex
    const elements = [];

    // First, try to extract from HTML structure
    const damageRegex = /(\d+d\d+(?:[+-]\d+)?)\s*(?:<sup>(?:<span[^>]*>([^<]+)<\/span>)?<\/sup>)?/g;
    let match;
    let matchFound = false;

    // Try to match the pattern: dice formula + optional superscript with damage type
    const pattern = /(\d+d\d+(?:[+-]\d+)?)\s*(?:<sup><span[^>]*>([^<]+)<\/span><\/sup>|\+)/g;
    let lastIndex = 0;
    let formulaMatches = [];

    // Extract all dice formulas with their types
    while ((match = pattern.exec(mainText)) !== null) {
        matchFound = true;
        if (match[1]) {
            formulaMatches.push({
                formula: match[1],
                type: match[2] || '',
                index: match.index
            });
        }
        lastIndex = pattern.lastIndex;
    }

    // If we found matches, process them
    if (matchFound) {
        // Process each formula match
        for (let i = 0; i < formulaMatches.length; i++) {
            elements.push({
                formula: formulaMatches[i].formula,
                type: formulaMatches[i].type
            });
        }
    } else {
        // Fallback: Try to extract using simpler regex patterns
        // First, get all dice formulas
        const dicePattern = /(\d+d\d+(?:[+-]\d+)?)/g;
        const diceMatches = [];
        while ((match = dicePattern.exec(mainText)) !== null) {
            diceMatches.push({
                formula: match[1],
                index: match.index
            });
        }

        // Then get all damage types from superscript spans
        const typeSpans = mainText.match(/<span class="superscript-damage[^"]*">([^<]+)<\/span>/g) || [];
        const types = typeSpans.map(span => {
            const typeMatch = span.match(/<span[^>]*>([^<]+)<\/span>/);
            return typeMatch ? typeMatch[1].trim() : '';
        });

        // Match formulas with types
        diceMatches.forEach((dice, index) => {
            elements.push({
                formula: dice.formula,
                type: index < types.length ? types[index] : ''
            });
        });
    }

    // If we still don't have elements, try one more approach
    if (elements.length === 0) {
        // Split by '+' and look for dice patterns
        const parts = mainText.split('+').map(part => part.trim());
        for (const part of parts) {
            const diceMatch = part.match(/^(\d+d\d+(?:[+-]\d+)?)/);
            if (diceMatch) {
                // Extract type if present
                const typeMatch = part.match(/<span class="superscript-damage[^"]*">([^<]+)<\/span>/);
                elements.push({
                    formula: diceMatch[1],
                    type: typeMatch ? typeMatch[1] : ''
                });
            }
        }
    }

    // If all else fails, try a direct approach with the example structure
    if (elements.length === 0) {
        // Try to directly extract from the example structure
        const mainDamageMatch = mainText.match(/(\d+d\d+\+\d+)<sup><span[^>]*>([^<]+)<\/span><\/sup>/);
        if (mainDamageMatch) {
            elements.push({
                formula: mainDamageMatch[1],
                type: mainDamageMatch[2]
            });

            // Look for additional damage
            const additionalMatch = mainText.match(/\+(\d+d\d+)<sup><span[^>]*>([^<]+)<\/span><\/sup>/);
            if (additionalMatch) {
                elements.push({
                    formula: additionalMatch[1],
                    type: additionalMatch[2]
                });
            }
        }
    }

    // If we still have no elements, try a very simple approach
    if (elements.length === 0) {
        // Just look for dice patterns and extract them
        const diceMatches = mainText.match(/\d+d\d+(?:[+-]\d+)?/g) || [];
        diceMatches.forEach(formula => {
            elements.push({
                formula: formula,
                type: ''
            });
        });
    }

    // Extract damage types from superscript spans if not already set
    const superscriptSpans = fullText.match(/<span class="superscript-damage[^"]*">([^<]+)<\/span>/g);
    if (superscriptSpans && elements.length > 0) {
        superscriptSpans.forEach((span, index) => {
            if (index < elements.length && !elements[index].type) {
                const typeMatch = span.match(/<span[^>]*>([^<]+)<\/span>/);
                if (typeMatch) {
                    elements[index].type = typeMatch[1].trim();
                }
            }
        });
    }

    // Final cleanup to ensure valid formulas
    elements.forEach(element => {
        // Make sure the formula doesn't contain any text
        element.formula = element.formula.replace(/[^0-9d+-]/g, '');

        // Make sure the type doesn't contain any dice notation
        if (element.type) {
            element.type = element.type.replace(/\d+d\d+[+-]?\d*/g, '').trim();
        }
    });

    return elements;
}

// Listen for clicks on damage elements
document.addEventListener('click', function(e) {
    // Check if we clicked on or inside the damage tooltip (with damage dice icon)
    const damageElement = e.target.closest('.tooltip');
    if (!damageElement || !damageElement.querySelector('img.icon-damage-dice')) return;

    // Stop event propagation to prevent double-handling
    e.stopPropagation();

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            // Only prevent default and stop propagation if blocking is enabled
            e.preventDefault();
            e.stopPropagation();
        }

        // Get the damage roll string from the weapon-span
        const damageSpan = damageElement.querySelector('span');
        if (!damageSpan) {
            console.warn("Damage span not found in the clicked element.");
            return;
        }

        // Get the full damage text content
        const fullDamageText = damageSpan.innerHTML;
        if (!fullDamageText) {
            console.warn("Damage text is empty.");
            return;
        }

        // For debugging
        console.log("Full damage HTML:", fullDamageText);

        // Parse the damage elements
        const damageElements = parseDamageElements(fullDamageText);
        console.log("Parsed damage elements:", damageElements);

        if (damageElements.length === 0) {
            console.warn("No valid damage elements found.");

            // Fallback to the old method if parsing fails
            const textContent = damageSpan.textContent.trim();
            const simpleMatch = textContent.match(/(\d+d\d+(?:[+-]\d+)?)/);
            if (simpleMatch) {
                damageElements.push({
                    formula: simpleMatch[1],
                    type: ''
                });
            } else {
                return;
            }
        }

        // Get critical information if it exists
        const critSpan = damageSpan.querySelector('.tooltiptextCrit');
        let critText = '';
        let critDamage = [];

        if (critSpan) {
            // Initialize variables for different crit sections
            let critMultiplier = '';
            let additionalCritDamage = [];

            // First, try to find the multiplier (2x)
            const critMultiplierText = critSpan.querySelector('.subtitle-map');
            if (critMultiplierText && critMultiplierText.nextSibling) {
                const multiplierText = critMultiplierText.nextSibling.textContent.trim();
                if (multiplierText.includes('x')) {
                    // Remove the ":" from the multiplier text if present
                    critMultiplier = multiplierText.replace(':', '');
                }
            }

            // Get the HTML content of the critSpan to find the "Plus" section
            const critHtml = critSpan.innerHTML;
            const plusIndex = critHtml.indexOf('Plus');

            if (plusIndex !== -1) {
                // Get all crit-text elements
                const critTextElements = critSpan.querySelectorAll('.crit-text');

                // Find the index of the crit-text element that comes after "Plus"
                let plusSectionStartIndex = -1;

                for (let i = 0; i < critTextElements.length; i++) {
                    const elementHtml = critTextElements[i].outerHTML;
                    const elementIndex = critHtml.indexOf(elementHtml);

                    if (elementIndex > plusIndex) {
                        plusSectionStartIndex = i;
                        break;
                    }
                }

                // Process all crit-text elements after the "Plus" section
                if (plusSectionStartIndex !== -1) {
                    for (let i = plusSectionStartIndex; i < critTextElements.length; i++) {
                        const text = critTextElements[i].textContent.trim();
                        if (text) {
                            // Extract dice formulas from the text
                            const parts = text.split('+').map(part => part.trim());
                            parts.forEach(part => {
                                const formulaMatch = part.match(/(\d+d\d+(?:[+-]\d+)?)/);
                                if (formulaMatch) {
                                    additionalCritDamage.push(formulaMatch[1]);
                                }
                            });
                        }
                    }
                }
            }

            // Format the crit text
            if (critMultiplier) {
                critText = critMultiplier;

                // Add clickable link for additional crit damage if it exists
                if (additionalCritDamage.length > 0) {
                    const additionalFormula = additionalCritDamage.join(' + ');
                    // Show the formula followed by the clickable link in parentheses
                    critText += ` + ${additionalFormula} ([Roll Additional Critical](\`/r ${additionalFormula}))`;
                }
            } else if (additionalCritDamage.length > 0) {
                // If no multiplier but we have additional damage
                const additionalFormula = additionalCritDamage.join(' + ');
                critText = `${additionalFormula} ([Roll Critical](\`/r ${additionalFormula}))`;
            }
        }

        // Get the weapon name from the parent container
        const weaponNameElement = damageElement.parentElement.querySelector('.weapon-name');
        const weaponName = weaponNameElement ? weaponNameElement.textContent.trim() : 'Attack';

        // Get the character name
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';

        // Process each damage element
        for (let i = 0; i < damageElements.length; i++) {
            const { formula, type } = damageElements[i];

            // Skip if formula is completely invalid (empty or contains non-dice characters)
            // But allow valid dice notation (numbers, d, +, -)
            if (!formula || !/^\d+d\d+([+-]\d+)?$/.test(formula)) {
                console.warn(`Skipping invalid formula: ${formula}`);
                continue;
            }

            // Create a descriptive label for additional damage elements
            const damageLabel = i === 0 ? 'Damage' : `Additional Damage`;

            // Create the roll template string for this damage element
            // Only include critical information in the first damage roll
            const rollString = `&{template:default} {{name=${charName} - ${weaponName} ${damageLabel}}} {{damage=[[${formula}]]}}${type ? ` {{type=${type}}}` : ''}${critText && i === 0 ? ` {{critical=${critText}}}` : ''}`;

            console.log(`Sending roll: ${rollString}`);

            // Handle roll string copying and sending
            // Add a small delay for additional damage elements to ensure they appear in order
            setTimeout(() => {
                handleRollString(rollString, `${damageLabel} roll`, e.clientX, e.clientY);
            }, i * 100);
        }
    });
});

// Listen for clicks on spell attack elements
document.addEventListener('click', function(e) {
    // Check if we clicked on a spell attack roll button
    const spellElement = e.target.closest('.dice-button.named-roll');
    if (!spellElement || !spellElement.textContent.includes('Spell Attack')) return;

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Get the attack bonus from the data-roll-value attribute
        const rollValue = spellElement.getAttribute('data-roll-value');
        if (!rollValue) {
            console.warn("Roll value not found.");
            return;
        }

        // Get the spell name from the data-title attribute or the closest title element
        const spellTitle = spellElement.closest('.listview-item').querySelector('.listview-title');
        const spellName = spellTitle ? spellTitle.textContent.trim() : 'Spell';

        // Get spell traits
        const traitsDiv = spellElement.closest('.listview-detail').querySelector('div:has(> .trait)');
        const traits = [];
        if (traitsDiv) {
            traitsDiv.querySelectorAll('.trait').forEach(trait => {
                traits.push(trait.textContent.trim());
            });
        }
        const traitsText = traits.length > 0 ? traits.join(', ') : '';

        // Get the character name
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';

        // Create the roll template string for spell attack
        const rollString = `&{template:default} {{name=${charName} - ${spellName} Attack}} {{attack=[[${rollValue}]]}}${traitsText ? ` {{traits=${traitsText}}}` : ''}`;

        // Handle roll string copying and sending
        handleRollString(rollString, 'Spell Attack roll', e.clientX, e.clientY);
    });
});

// Listen for clicks on spell damage elements
document.addEventListener('click', function(e) {
    // Check if we clicked on a spell damage roll button (dice-button that's not a spell attack)
    const spellElement = e.target.closest('.dice-button.named-roll');
    if (!spellElement || spellElement.textContent.includes('Spell Attack')) return;

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Get the damage roll from the data-roll-value attribute
        const rollValue = spellElement.getAttribute('data-roll-value');
        if (!rollValue) {
            console.warn("Roll value not found.");
            return;
        }

        // Get the spell name from the closest title element
        const spellTitle = spellElement.closest('.listview-item').querySelector('.listview-title');
        const spellName = spellTitle ? spellTitle.textContent.trim() : 'Spell';

        // Get spell traits
        const traitsDiv = spellElement.closest('.listview-detail').querySelector('div:has(> .trait)');
        const traits = [];
        if (traitsDiv) {
            traitsDiv.querySelectorAll('.trait').forEach(trait => {
                traits.push(trait.textContent.trim());
            });
        }
        const traitsText = traits.length > 0 ? traits.join(', ') : '';

        // Get spell description to find damage type
        const description = spellElement.getAttribute('data-description');
        let damageType = null;
        if (description) {
            // Look for damage types in the description
            const damageTypes = ['bludgeoning', 'piercing', 'slashing', 'fire', 'cold', 'acid', 'electricity', 'sonic', 'force', 'mental', 'poison', 'positive', 'negative'];
            for (const type of damageTypes) {
                if (description.toLowerCase().includes(type)) {
                    damageType = type.charAt(0).toUpperCase() + type.slice(1);
                    break;
                }
            }
        }

        // Get the character name
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';

        // Create the roll template string for spell damage
        const rollString = `&{template:default} {{name=${charName} - ${spellName} Damage}} {{damage=[[${rollValue}]]}}${damageType ? ` {{type=${damageType}}}` : ''}${traitsText ? ` {{traits=${traitsText}}}` : ''}`;

        // Handle roll string copying and sending
        handleRollString(rollString, 'Spell Damage roll', e.clientX, e.clientY);
    });
});

// Listen for clicks on ability score modifiers
document.addEventListener('click', function(e) {
    // Check if we clicked on an ability modifier
    const abilityElement = e.target.closest('.ability-span');
    if (!abilityElement) return;

    // Get the current tinting preference before handling the click
    chrome.storage.sync.get(['blockTinting'], function(result) {
        const blockTinting = result.blockTinting !== false;

        if (blockTinting) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Get the ability label and modifier
        const abilityLabel = abilityElement.querySelector('.abilityLabel');
        const abilityMod = abilityElement.querySelector('.abilityMod');

        if (!abilityLabel || !abilityMod) {
            console.warn("Ability label or modifier not found.");
            return;
        }

        const ability = abilityLabel.textContent.trim();
        let modifier = abilityMod.textContent.trim();

        // Get the character name
        const charButton = document.getElementsByClassName("button-name")[0]
		const charButtonSelection = charButton ? charButton.getElementsByClassName("button-selection")[0]: null;
        const charName = charButtonSelection ? charButtonSelection.textContent.trim() : 'Unknown Character';

        // Create the roll template string for ability check
        const rollString = `&{template:default} {{name=${charName} - ${ability} Check}} {{roll=[[1d20${modifier}]]}} {{modifier=${modifier}}}`;

        // Handle roll string copying and sending
        handleRollString(rollString, `${ability} Check`, e.clientX, e.clientY);
    });
});

// Function to show a temporary pop-up at the click coordinates.
function showPopup(message, x, y) {
  const popup = document.createElement("div");
  popup.textContent = message;

  // Style the pop-up.
  popup.style.position = "fixed";
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  popup.style.color = "white";
  popup.style.padding = "8px 12px";
  popup.style.borderRadius = "4px";
  popup.style.zIndex = "9999";
  popup.style.opacity = "1";
  popup.style.transition = "opacity 1s ease-out";

  // Append the pop-up to the document.
  document.body.appendChild(popup);

  // Fade out and remove the pop-up after a short time.
  setTimeout(() => {
    popup.style.opacity = "0";
  }, 1000);
  setTimeout(() => {
    popup.remove();
  }, 2000);
}

// Debug function to log HTML structure
function logHTMLStructure(element) {
    console.log('HTML Structure:', element.outerHTML);
}

// Function to handle roll string copying and sending
function handleRollString(rollString, description, x, y, options = {}) {
    // Get the clipboard preference
    chrome.storage.sync.get(['copyToClipboard'], function(result) {
        const shouldCopy = result.copyToClipboard === true;

        const actions = [];

        // Only copy to clipboard if enabled
        if (shouldCopy) {
            actions.push(
                navigator.clipboard.writeText(rollString)
                    .then(() => {
                        console.log(`Copied roll string: ${rollString}`);
                    })
                    .catch(err => {
                        console.error('Error copying text: ', err);
                    })
            );
        }

        // Always send to Roll20
        actions.push(
            chrome.runtime.sendMessage({
                type: 'ROLL_STRING',
                rollString: rollString,
                initiative: options?.initiative
            })
            .then(response => {
                console.log('Background response:', response);
                if (!response || !response.success) {
                    console.warn('Failed to process roll:', response?.error || 'No response');
                    showPopup('Failed to send to Roll20: ' + (response?.error || 'No response'), x, y);
                    return;
                }

                if (response?.initiative && !response.initiative.success) {
                    console.warn('Initiative tracker update failed:', response.initiative.error);
                }
            })
            .catch(err => {
                console.warn('Failed to send roll:', err);
                showPopup('Failed to send to Roll20: ' + err.message, x, y);
            })
        );

        // Execute all actions
        Promise.all(actions)
            .then(() => {
                // Only show the "Copied" message if clipboard copying is enabled
                if (shouldCopy) {
                    showPopup(`Copied: ${description}`, x, y);
                } else {
                    showPopup(`Sent to Roll20: ${description}`, x, y);
                }
            });
    });
}
