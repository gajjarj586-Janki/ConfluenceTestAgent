Feature: Verify ROAP and CPC pricing using FCAI

  Background:
    Given I load the Driveaway Price test data

  @DriveawayPrice
  Scenario: Verify MLP and Driveaway Price between ROAP and CPC

    # ROAP
    Given I open the ROAP URL from test data
    When I login using the username and password from test data
    And I retrieve the FCAI from test data
    And I search the vehicle using FCAI
    And I capture the MLP from ROAP
    And I capture the Driveaway Price from ROAP

    # CPC
    When I open the CPC URL from test data
    And I set the dealer using the postcode and suburb from test data
    And I locate the vehicle whose serviceId equals the FCAI
    Then I verify the CPC priceEstimate matches the ROAP MLP
    And I verify the CPC Estimated Drive Away price matches the ROAP Driveaway Price