Feature: Hyundai Calculator - Verify Drive Away pricing for all models and variants
  As a QA tester
  I want to navigate to the calculator landing page and inspect every model and variant
  So that I can verify each variant loads its CPC page and shows a valid Drive Away price
  And flag any variant whose Drive Away widget displays "Pricing coming soon" or whose CPC page fails to load

  Background:
    Given the user is on the Hyundai Australia homepage "https://www.hyundai.com/au/en"
    And the page is fully loaded

  @calculator @pricing @smoke @no-autofix
  Scenario: Verify Drive Away pricing is displayed for every calculator model and variant
    When the user navigates to the calculator landing page
    Then the calculator landing page should list at least 1 model
    When the user inspects every model and its variants on the calculator
    Then no model should show "Pricing coming soon"
    And a calculator pricing report should be generated
      # Report contains one row per configuration with columns:
      #   Model | Configuration (Energy type / Variant / Powertrain / Transmission) | Drive Away | Test Status (PASS/FAIL) | Failure Reason
      # Failure Reason examples:
      #   - "CPC page is not loading"
      #   - "Drive Away price shows \"Pricing coming soon\" for variant \"X\""
      #   - "Unable to select variant \"X\": <error>"
      #   - "Drive Away price not displayed for variant \"X\""
      # Artefacts: excel-reports/CalculatorPricing_<timestamp>.{html,json,pdf}
