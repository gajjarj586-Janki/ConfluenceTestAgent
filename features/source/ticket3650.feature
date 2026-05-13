Feature: Model Variant Carousel Navigation Performance

  @performance @pip @variant-carousel
  Scenario Outline: Verify variant carousel navigation performance across model pages
    Given user navigates to "<pageUrl>"
    When user clicks on the "<variantTab>" variant tab
    Then the target page should load successfully
    And the page URL should not contain "?id="
    And the page response time should be less than 200ms
    And no renderer freeze or excessive idle time should occur

    Examples:
      | pageUrl | variantTab |
      | /au/en/cars/suvs/kona | KONA Hybrid |
      | /au/en/cars/suvs/kona | KONA Electric |
      | /au/en/cars/suvs/santa-fe | SANTA FE Hybrid |
      | /au/en/cars/small-cars/i30-hatch-n-line | i30 N |
      | /au/en/cars/small-cars/i30-sedan | i30 Sedan Hybrid |
      | /au/en/cars/small-cars/i30-sedan | i30 Sedan N |
      | /au/en/cars/electric/ioniq5-n | IONIQ 5 N |